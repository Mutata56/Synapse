"""Read-only macOS counters; pass verified app and WebKit process IDs.

100% CPU is one logical core. Footprint sums process charges.
This does not measure battery energy or cached logical filesystem reads.
"""
import argparse
import ctypes as c
import json
import os
import time
from pathlib import Path


class Usage(c.Structure):
    _fields_ = [("uuid", c.c_uint8 * 16)] + [(name, c.c_uint64) for name in (
        "user", "system", "idle_wakeups", "interrupt_wakeups", "pageins",
        "wired", "resident", "footprint", "start", "exit",
        "child_user", "child_system", "child_idle", "child_interrupt",
        "child_pageins", "child_elapsed", "disk_read", "disk_write",
    )]


class Timebase(c.Structure):
    _fields_ = [("numer", c.c_uint32), ("denom", c.c_uint32)]


proc = c.CDLL("/usr/lib/libproc.dylib", use_errno=True)
proc.proc_pid_rusage.argtypes = [c.c_int, c.c_int, c.POINTER(Usage)]
system = c.CDLL(None)
clock = Timebase()
assert system.mach_timebase_info(c.byref(clock)) == 0
scale = clock.numer / clock.denom


def read(pid):
    value = Usage()
    if proc.proc_pid_rusage(pid, 2, c.byref(value)):
        raise OSError(c.get_errno(), f"proc_pid_rusage({pid})")
    return {name: getattr(value, name) for name, _ in Usage._fields_ if name != "uuid"}


def validate_clock():
    before = read(os.getpid())
    started = time.process_time()
    while time.process_time() - started < .15:
        pass
    elapsed = time.process_time() - started
    after = read(os.getpid())
    measured = (after["user"] + after["system"] - before["user"] - before["system"]) * scale / 1e9
    assert abs(measured / elapsed - 1) < .1, (measured, elapsed, scale)


parser = argparse.ArgumentParser()
parser.add_argument("--pids", required=True)
parser.add_argument("--seconds", type=int, default=20)
parser.add_argument("--label", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
validate_clock()
pids = [int(pid) for pid in args.pids.split(",")]
started = time.monotonic()
snapshots = []
for index in range(args.seconds + 1):
    snapshots.append({"time": time.monotonic() - started, "processes": {pid: read(pid) for pid in pids}})
    if index < args.seconds:
        time.sleep(1)
first, last = snapshots[0], snapshots[-1]
duration = last["time"] - first["time"]
delta = lambda name: sum(last["processes"][pid][name] - first["processes"][pid][name] for pid in pids)
summary = {
    "label": args.label, "pids": pids, "seconds": duration,
    "cpuPercentOneCore": (delta("user") + delta("system")) * scale / 1e9 / duration * 100,
    "idleWakeupsPerSecond": delta("idle_wakeups") / duration,
    "diskReadBytes": delta("disk_read"), "diskWriteBytes": delta("disk_write"),
    "footprintMiBStart": sum(value["footprint"] for value in first["processes"].values()) / 1048576,
    "footprintMiBEnd": sum(value["footprint"] for value in last["processes"].values()) / 1048576,
    "machTimebase": {"numer": clock.numer, "denom": clock.denom},
}
Path(args.out).write_text(json.dumps({"summary": summary, "snapshots": snapshots}, indent=2) + "\n")
print(json.dumps(summary, indent=2))
