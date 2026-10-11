"""Read-only usage sampler, including launchd-hosted WebKit responsibility."""
import argparse
import ctypes
import json
import os
import subprocess
import time
from pathlib import Path

FIELDS = "user_time system_time pkg_idle_wkups interrupt_wkups pageins wired_size resident_size phys_footprint proc_start_abstime proc_exit_abstime child_user_time child_system_time child_pkg_idle_wkups child_interrupt_wkups child_pageins child_elapsed_abstime diskio_bytesread diskio_byteswritten".split()
class Usage(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [(key, ctypes.c_uint64) for key in FIELDS]
class Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]
lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
lib.proc_pid_rusage.restype = ctypes.c_int
owner = getattr(lib, "responsibility_get_pid_responsible_for_pid", None)
if owner:
    owner.argtypes = [ctypes.c_int]
    owner.restype = ctypes.c_int
base = Timebase()
lib.mach_timebase_info(ctypes.byref(base))
ns_per_tick = base.numer / base.denom

def usage(pid):
    value = Usage()
    if lib.proc_pid_rusage(pid, 2, ctypes.byref(value)):
        return None
    return {name: int(getattr(value, name)) for name in FIELDS}

def calibrate():
    first = usage(os.getpid())
    cpu0 = time.process_time_ns()
    end = time.monotonic() + .25
    while time.monotonic() < end:
        sum(i * i for i in range(100))
    cpu1 = time.process_time_ns()
    last = usage(os.getpid())
    ticks = last["user_time"] + last["system_time"] - first["user_time"] - first["system_time"]
    ratio = ticks * ns_per_tick / (cpu1 - cpu0)
    if not .95 < ratio < 1.05:
        raise RuntimeError("CPU counter unit calibration failed")
    return {"nsPerTick": ns_per_tick, "calibrationRatio": ratio}

def owned_processes(pid):
    rows = subprocess.check_output(["ps", "-axo", "pid=,comm="], text=True).splitlines()
    result = []
    for line in rows:
        bits = line.strip().split(None, 1)
        if len(bits) != 2:
            continue
        candidate = int(bits[0])
        if candidate != pid and (not owner or owner(candidate) != pid):
            continue
        info = usage(candidate)
        if info:
            result.append({"pid": candidate, "role": Path(bits[1]).name, **info})
    return result

parser = argparse.ArgumentParser()
parser.add_argument("--pid", type=int)
parser.add_argument("--output", type=Path)
parser.add_argument("--phase", type=Path)
parser.add_argument("--seconds", type=float, default=60)
parser.add_argument("--calibrate", action="store_true")
args = parser.parse_args()
calibration = calibrate()
if args.calibrate:
    print(json.dumps(calibration))
    raise SystemExit()
if not args.pid or not args.output:
    parser.error("--pid and --output are required")
args.output.parent.mkdir(parents=True, exist_ok=True)
previous = {}
previous_time = None
end = time.monotonic() + args.seconds
with args.output.open("w") as output:
    while time.monotonic() < end:
        now = time.monotonic()
        rows = owned_processes(args.pid)
        seconds = now - previous_time if previous_time is not None else 0
        cpu = 0
        deltas = {field: 0 for field in ["pkg_idle_wkups", "interrupt_wkups", "diskio_bytesread", "diskio_byteswritten"]}
        for row in rows:
            old = previous.get(row["pid"])
            if not old or old["proc_start_abstime"] != row["proc_start_abstime"]:
                continue
            cpu += max(0, row["user_time"] + row["system_time"] - old["user_time"] - old["system_time"])
            for field in deltas:
                deltas[field] += max(0, row[field] - old[field])
        sample = {"utc": time.time(), "monotonic": now, "seconds": seconds,
                  "phase": args.phase.read_text().strip() if args.phase and args.phase.exists() else "unlabelled",
                  "cpuPercent": 100 * cpu * ns_per_tick / 1e9 / seconds if seconds else None,
                  "footprintBytes": sum(row["phys_footprint"] for row in rows),
                  "residentBytes": sum(row["resident_size"] for row in rows),
                  "rendererAttribution": bool(owner), "deltas": deltas, "processes": rows, **calibration}
        output.write(json.dumps(sample) + "\n")
        output.flush()
        if previous_time is None:
            print(json.dumps({"started": True, "pids": [row["pid"] for row in rows], "roles": [row["role"] for row in rows], "footprintMiB": sample["footprintBytes"] / 1048576}), flush=True)
        previous = {row["pid"]: row for row in rows}
        previous_time = now
        time.sleep(.5)
