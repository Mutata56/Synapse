# Read-only macOS process-family observer. Native GUI actions belong in CUA.
import argparse
import ctypes
import json
import subprocess
import time
from pathlib import Path

FIELDS = 'user_time system_time pkg_idle_wkups interrupt_wkups pageins wired_size resident_size phys_footprint proc_start_abstime proc_exit_abstime child_user_time child_system_time child_pkg_idle_wkups child_interrupt_wkups child_pageins child_elapsed_abstime diskio_bytesread diskio_byteswritten'.split()
class Usage(ctypes.Structure):
    _fields_ = [('uuid',ctypes.c_uint8*16)] + [(field,ctypes.c_uint64) for field in FIELDS]
lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True)
lib.proc_pid_rusage.argtypes = [ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
lib.proc_pid_rusage.restype = ctypes.c_int
owner = getattr(lib,'responsibility_get_pid_responsible_for_pid',None)
if not owner: raise SystemExit('Process ownership API is unavailable; do not guess WebKit attribution')
owner.argtypes = [ctypes.c_int]; owner.restype = ctypes.c_int
class Timebase(ctypes.Structure):
    _fields_ = [('numer',ctypes.c_uint32),('denom',ctypes.c_uint32)]
timebase=Timebase()
lib.mach_timebase_info(ctypes.byref(timebase))
nanoseconds_per_tick=timebase.numer/timebase.denom

def processes(main_pid):
    rows = subprocess.run(['ps','-axo','pid=,comm='],text=True,capture_output=True,check=True).stdout.splitlines()
    found = []
    for row in rows:
        parts = row.strip().split(None,1)
        if len(parts)!=2: continue
        pid = int(parts[0])
        if pid != main_pid and owner(pid) != main_pid: continue
        usage = Usage()
        if lib.proc_pid_rusage(pid,2,ctypes.byref(usage)) != 0: continue
        found.append(dict(pid=pid,role=Path(parts[1]).name,**{field:int(getattr(usage,field)) for field in FIELDS}))
    return found

parser=argparse.ArgumentParser()
parser.add_argument('--pid',type=int,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--phase',type=Path,required=True)
parser.add_argument('--seconds',type=float,default=900)
args=parser.parse_args()
args.output.parent.mkdir(parents=True,exist_ok=True)
end=time.monotonic()+args.seconds
previous={}
previous_time=None
main_start=None
with args.output.open('w') as output:
    while time.monotonic()<end:
        now=time.monotonic()
        rows=processes(args.pid)
        main=next((row for row in rows if row['pid']==args.pid),None)
        if not main: break
        if main_start is None: main_start=main['proc_start_abstime']
        elif main['proc_start_abstime']!=main_start: break
        phase=args.phase.read_text().strip() if args.phase.exists() else 'setup'
        cpu_ticks=0; wakeups=0; read_bytes=0; write_bytes=0
        for row in rows:
            old=previous.get(row['pid'])
            if not old or old['proc_start_abstime']!=row['proc_start_abstime']: continue
            cpu_ticks += max(0,row['user_time']+row['system_time']-old['user_time']-old['system_time'])
            wakeups += max(0,row['interrupt_wkups']-old['interrupt_wkups'])
            read_bytes += max(0,row['diskio_bytesread']-old['diskio_bytesread'])
            write_bytes += max(0,row['diskio_byteswritten']-old['diskio_byteswritten'])
        elapsed=now-previous_time if previous_time is not None else 0
        sample=dict(monotonic=now,phase=phase,seconds=elapsed,cpuPercent=100*cpu_ticks*nanoseconds_per_tick/1e9/elapsed if elapsed else None,interruptWakeups=wakeups,readBytes=read_bytes,writeBytes=write_bytes,footprintBytes=sum(row['phys_footprint'] for row in rows),residentBytes=sum(row['resident_size'] for row in rows),processes=rows,nanosecondsPerTick=nanoseconds_per_tick)
        output.write(json.dumps(sample)+'\n'); output.flush()
        if not previous_time: print(json.dumps({'started':True,'pids':[row['pid'] for row in rows],'roles':[row['role'] for row in rows],'footprintMiB':round(sample['footprintBytes']/1048576,2)}),flush=True)
        previous={row['pid']:row for row in rows}; previous_time=now
        time.sleep(.5)
