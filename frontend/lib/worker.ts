import { compute_envelope } from "./signal-processing.ts"



export type ComputeEnvelopeTask = {
    type:    'compute-envelope'
    signal:  Float32Array;
    fs:      number;
    f_min:   number;
    f_max:   number;

    task_id: number;
}

export type Task = ComputeEnvelopeTask;



export type ComputeEnvelopeResult = {
    task_id:  number;
    envelope: Float32Array;
}

export type WorkerResult = ComputeEnvelopeResult;







// main entry point
self.onmessage = async (e:MessageEvent) => {
    const task:Task = e.data;
    let result: WorkerResult|Error;

    if(task.type == 'compute-envelope') {
        const envelope: Float32Array = 
            compute_envelope(task.signal, task.fs, task.f_min, task.f_max)
        result = {
            task_id:   task.task_id,
            envelope : envelope,
        }
    } else {
        result = new Error(`Unknown worker task type: ${task.type}`)
    }

    self.postMessage(result)
}




self.addEventListener('error', (e:ErrorEvent) => {
    e.preventDefault();
    const msg:string = 
        `Worker ${self.name} error: ${e.message} (${e.filename}:${e.lineno})-${e.colno})`
    console.error(msg, e)
    self.postMessage(new Error(msg));
    self.close();
});


self.onunhandledrejection = (e:PromiseRejectionEvent) => {
    e.preventDefault()
    const msg:string = `Worker ${self.name} unhandled rejection: ${e.reason}`
    console.error(msg)
    self.postMessage(new Error(msg))
    self.close()
}


