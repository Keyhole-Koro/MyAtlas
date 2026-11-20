window.ATLAS_CODE = {
 "root": "~/Workspaces/MyComputer",
 "files": {
  "system/MyOS/src/apps/tasks.dom.mln": {
   "lang": "mylang",
   "lines": 480
  },
  "system/MyAppFramework/src/runtime/runtime.unsafe.mln": {
   "lang": "mylang",
   "lines": 599
  },
  "system/MyAppFramework/src/elements.mln": {
   "lang": "mylang",
   "lines": 698
  },
  "system/MyAppFramework/src/runtime/transport.unsafe.mln": {
   "lang": "mylang",
   "lines": 58
  },
  "toolchain/MyStdLib/hosted/process.unsafe.mln": {
   "lang": "mylang",
   "lines": 142
  },
  "system/MyOS/src/syscall/router.unsafe.mln": {
   "lang": "mylang",
   "lines": 97
  },
  "system/MyOS/src/ipc/gateway.unsafe.mln": {
   "lang": "mylang",
   "lines": 319
  },
  "system/MyOS/src/ipc/channel.unsafe.mln": {
   "lang": "mylang",
   "lines": 174
  },
  "system/MyOS/src/ui/protocol.unsafe.mln": {
   "lang": "mylang",
   "lines": 204
  },
  "system/MyOS/src/ui/dom/dom_model.model.mln": {
   "lang": "mylang",
   "lines": 55
  },
  "system/MyOS/src/ipc/events.unsafe.mln": {
   "lang": "mylang",
   "lines": 192
  },
  "system/MyOS/src/proc/stats.unsafe.mln": {
   "lang": "mylang",
   "lines": 188
  },
  "system/MyOS/src/ui/dom/dom_render.mln": {
   "lang": "mylang",
   "lines": 1145
  },
  "system/MyOS/src/ui/dom/dom_hit_test.mln": {
   "lang": "mylang",
   "lines": 70
  },
  "system/MyKernel/src/kernel/syscall.unsafe.mln": {
   "lang": "mylang",
   "lines": 573
  },
  "system/MyKernel/src/kernel/irq_dispatch.unsafe.mln": {
   "lang": "mylang",
   "lines": 162
  },
  "system/MyKernel/src/kernel/scheduler.unsafe.mln": {
   "lang": "mylang",
   "lines": 535
  },
  "system/MyKernel/src/kernel/ipc.unsafe.mln": {
   "lang": "mylang",
   "lines": 140
  },
  "system/MyKernel/src/mm/heap.unsafe.mln": {
   "lang": "mylang",
   "lines": 286
  },
  "system/MyKernel/src/mm/frames.unsafe.mln": {
   "lang": "mylang",
   "lines": 81
  },
  "system/MyKernel/src/kernel/thread.unsafe.mln": {
   "lang": "mylang",
   "lines": 1245
  },
  "runtime/MyEmulator/src/machine/timer.rs": {
   "lang": "rust",
   "lines": 382
  },
  "contracts/myapp/message.contract.mln": {
   "lang": "mylang",
   "lines": 75
  },
  "contracts/myos/process-args.contract.mln": {
   "lang": "mylang",
   "lines": 130
  },
  "contracts/myapp/ui.contract.mln": {
   "lang": "mylang",
   "lines": 55
  },
  "contracts/myos/services.contract.mln": {
   "lang": "mylang",
   "lines": 65
  }
 },
 "nodes": {
  "app.tasks": {
   "path": "system/MyOS/src/apps/tasks.dom.mln",
   "symbol": "tick",
   "start": 108,
   "end": 128
  },
  "app.tasks-view": {
   "path": "system/MyOS/src/apps/tasks.dom.mln",
   "symbol": "view",
   "start": 94,
   "end": 104
  },
  "mem.user-request": {
   "path": "system/MyAppFramework/src/runtime/runtime.unsafe.mln",
   "symbol": "send",
   "start": 200,
   "end": 200
  },
  "app.tasks-share": {
   "path": "system/MyOS/src/apps/tasks.dom.mln",
   "symbol": "share",
   "start": 148,
   "end": 158
  },
  "app.tasks-last": {
   "path": "system/MyOS/src/apps/tasks.dom.mln",
   "symbol": "tick",
   "start": 109,
   "end": 109
  },
  "app.tasks-series": {
   "path": "system/MyOS/src/apps/tasks.dom.mln",
   "symbol": "record",
   "start": 113,
   "end": 113
  },
  "app.tasks-show": {
   "path": "system/MyOS/src/apps/tasks.dom.mln",
   "symbol": "show",
   "start": 377,
   "end": 456
  },
  "lib.send-text": {
   "path": "system/MyAppFramework/src/elements.mln",
   "symbol": "send_text",
   "start": 585,
   "end": 590
  },
  "lib.transport": {
   "path": "system/MyAppFramework/src/runtime/transport.unsafe.mln",
   "symbol": "request",
   "start": 29,
   "end": 44
  },
  "lib.next": {
   "path": "system/MyAppFramework/src/runtime/runtime.unsafe.mln",
   "symbol": "next",
   "start": 491,
   "end": 506
  },
  "lib.process-stats": {
   "path": "toolchain/MyStdLib/hosted/process.unsafe.mln",
   "symbol": "stats",
   "start": 135,
   "end": 141
  },
  "os.router": {
   "path": "system/MyOS/src/syscall/router.unsafe.mln",
   "symbol": "handle",
   "start": 39,
   "end": 68
  },
  "os.gateway": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "request",
   "start": 204,
   "end": 221
  },
  "os.request-ring": {
   "path": "system/MyOS/src/ipc/channel.unsafe.mln",
   "symbol": "g_requests",
   "start": 24,
   "end": 24
  },
  "os.serve": {
   "path": "system/MyOS/src/ipc/channel.unsafe.mln",
   "symbol": "serve",
   "start": 151,
   "end": 173
  },
  "os.ui-protocol": {
   "path": "system/MyOS/src/ui/protocol.unsafe.mln",
   "symbol": "handle",
   "start": 65,
   "end": 70
  },
  "os.dom": {
   "path": "system/MyOS/src/ui/dom/dom_model.model.mln",
   "symbol": null,
   "start": null,
   "end": null
  },
  "os.events": {
   "path": "system/MyOS/src/ipc/events.unsafe.mln",
   "symbol": "push",
   "start": 163,
   "end": 191
  },
  "os.proc-stats": {
   "path": "system/MyOS/src/proc/stats.unsafe.mln",
   "symbol": "fill",
   "start": 71,
   "end": 96
  },
  "os.submit": {
   "path": "system/MyOS/src/ipc/channel.unsafe.mln",
   "symbol": "submit",
   "start": 134,
   "end": 140
  },
  "gateway.read": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "read_user_request",
   "start": 95,
   "end": 103
  },
  "gateway.owner": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "request",
   "start": 204,
   "end": 221
  },
  "gateway.copy": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "copy_request_strings",
   "start": 110,
   "end": 117
  },
  "gateway.stage": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "stage_request_outputs",
   "start": 125,
   "end": 151
  },
  "gateway.slots": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "GatewaySlot",
   "start": 54,
   "end": 66
  },
  "gateway.full": {
   "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
   "symbol": "request",
   "start": 204,
   "end": 221
  },
  "channel.encode": {
   "path": "system/MyOS/src/ipc/channel.unsafe.mln",
   "symbol": "encode_request_words",
   "start": 90,
   "end": 108
  },
  "channel.words": {
   "path": "system/MyOS/src/ipc/channel.unsafe.mln",
   "symbol": "submit",
   "start": 134,
   "end": 134
  },
  "os.dom-render": {
   "path": "system/MyOS/src/ui/dom/dom_render.mln",
   "symbol": "render",
   "start": 1066,
   "end": 1086
  },
  "os.dom-hit": {
   "path": "system/MyOS/src/ui/dom/dom_hit_test.mln",
   "symbol": "hit_row",
   "start": 20,
   "end": 41
  },
  "kernel.os-call": {
   "path": "system/MyKernel/src/kernel/syscall.unsafe.mln",
   "symbol": "dispatch",
   "start": 446,
   "end": 572
  },
  "kernel.irq-dispatch": {
   "path": "system/MyKernel/src/kernel/irq_dispatch.unsafe.mln",
   "symbol": "dispatch",
   "start": 61,
   "end": 161
  },
  "kernel.tick": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "tick",
   "start": 235,
   "end": 243
  },
  "kernel.reschedule": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "reschedule",
   "start": 265,
   "end": 338
  },
  "kernel.cpu-time": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "charge_elapsed",
   "start": 109,
   "end": 113
  },
  "kernel.cpu-counters": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "g_idle_time",
   "start": 57,
   "end": 57
  },
  "kernel.wfi-wait": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "wait_in_wfi",
   "start": 138,
   "end": 144
  },
  "kernel.idle-hold": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "hold_until_due",
   "start": 152,
   "end": 172
  },
  "kernel.ipc-send": {
   "path": "system/MyKernel/src/kernel/ipc.unsafe.mln",
   "symbol": "send",
   "start": 83,
   "end": 95
  },
  "kernel.notify-armed": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "notify_armed",
   "start": 413,
   "end": 413
  },
  "charge.read": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "charge_elapsed",
   "start": 109,
   "end": 113
  },
  "kernel.charge": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "charge",
   "start": 96,
   "end": 106
  },
  "charge.set": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "charge_elapsed",
   "start": 109,
   "end": 113
  },
  "kernel.clock-charged": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "g_clock_charged",
   "start": 55,
   "end": 55
  },
  "kernel.charge-to": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "charge_to",
   "start": 121,
   "end": 121
  },
  "kernel.channel": {
   "path": "system/MyKernel/src/kernel/ipc.unsafe.mln",
   "symbol": "Channel",
   "start": 43,
   "end": 47
  },
  "kernel.heap": {
   "path": "system/MyKernel/src/mm/heap.unsafe.mln",
   "symbol": "g_free_head",
   "start": 26,
   "end": 26
  },
  "kernel.frames": {
   "path": "system/MyKernel/src/mm/frames.unsafe.mln",
   "symbol": "g_free",
   "start": 22,
   "end": 22
  },
  "kernel.threads": {
   "path": "system/MyKernel/src/kernel/thread.unsafe.mln",
   "symbol": "g_threads",
   "start": 156,
   "end": 156
  },
  "kernel.find-next": {
   "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
   "symbol": "find_next_runnable",
   "start": 207,
   "end": 217
  },
  "kernel.thread-state": {
   "path": "system/MyKernel/src/kernel/thread.unsafe.mln",
   "symbol": "ThreadState",
   "start": 120,
   "end": 126
  },
  "emulator.timer.clock": {
   "path": "runtime/MyEmulator/src/machine/timer.rs",
   "symbol": "clock",
   "start": 150,
   "end": 150
  },
  "fig.clock-word": {
   "path": "runtime/MyEmulator/src/machine/timer.rs",
   "symbol": "clock",
   "start": 150,
   "end": 150
  },
  "schema.request": {
   "path": "contracts/myapp/message.contract.mln",
   "symbol": "Request",
   "start": 21,
   "end": 41
  },
  "schema.event": {
   "path": "contracts/myapp/message.contract.mln",
   "symbol": "Event",
   "start": 65,
   "end": 74
  },
  "schema.procstats": {
   "path": "contracts/myos/process-args.contract.mln",
   "symbol": "ProcStats",
   "start": 119,
   "end": 125
  },
  "schema.cputimes": {
   "path": "contracts/myos/process-args.contract.mln",
   "symbol": "CpuTimes",
   "start": 104,
   "end": 109
  },
  "schema.procinfo": {
   "path": "contracts/myos/process-args.contract.mln",
   "symbol": "ProcInfo",
   "start": 85,
   "end": 93
  },
  "schema.event-kind": {
   "path": "contracts/myapp/message.contract.mln",
   "symbol": "EventKind",
   "start": 52,
   "end": 62
  },
  "schema.request-domain": {
   "path": "contracts/myapp/message.contract.mln",
   "symbol": "RequestDomain",
   "start": 7,
   "end": 11
  },
  "schema.request-status": {
   "path": "contracts/myapp/message.contract.mln",
   "symbol": "RequestStatus",
   "start": 14,
   "end": 19
  },
  "schema.uiop": {
   "path": "contracts/myapp/ui.contract.mln",
   "symbol": "UiOp",
   "start": 6,
   "end": 43
  },
  "schema.os-service": {
   "path": "contracts/myos/services.contract.mln",
   "symbol": "OsService",
   "start": 7,
   "end": 40
  }
 },
 "steps": {
  "ui": {
   "6": {
    "path": "system/MyOS/src/ipc/channel.unsafe.mln",
    "line": 164
   }
  },
  "cpu": {
   "1": {
    "path": "system/MyKernel/src/kernel/irq_dispatch.unsafe.mln",
    "line": 154
   },
   "2": {
    "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
    "line": 242
   },
   "3": {
    "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
    "line": 270
   },
   "6": {
    "path": "system/MyOS/src/apps/tasks.dom.mln",
    "line": 110
   },
   "8": {
    "path": "system/MyOS/src/proc/stats.unsafe.mln",
    "line": 75
   }
  },
  "app.tasks": {},
  "kernel.cpu-time": {
   "1": {
    "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
    "line": 111
   },
   "3": {
    "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
    "line": 104
   },
   "5": {
    "path": "system/MyKernel/src/kernel/scheduler.unsafe.mln",
    "line": 112
   }
  },
  "os.gateway": {
   "2": {
    "path": "system/MyOS/src/ipc/gateway.unsafe.mln",
    "line": 213
   }
  },
  "os.submit": {}
 }
};
