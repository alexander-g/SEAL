import { is_deno } from '../lib/util.ts'

import type { 
    ComputeEnvelopeTask, 
    ComputeBandPowerRatioTask,
    Task,
    WorkerResult,
} from './worker.ts'
import type { FrequencyBand } from './signal-processing.ts'



/** Pool of web workers for compute intensive tasks */
export class WorkerPool {
    constructor(size?:number) {
        size = size ?? navigator.hardwareConcurrency;

        for(let i:number = 0; i < size; i++) {
            const worker = new Worker(get_worker_url(), {type:'module'})
            worker.addEventListener('message', this.on_worker_message)
            worker.addEventListener('error', this.on_worker_error)
            this.workers.push({worker, busy:false})
        }
    }

    terminate() {
        for(const {worker} of this.workers)
            worker.terminate()
    }


    // tasks

    compute_envelope(
        signal: Float32Array, 
        fs:     number, 
        f_min:  number, 
        f_max:  number
    ): Promise<{promise: Promise<Float32Array|Error>}> {
        return new Promise( (promise_resolve) => {
            const task_id:number = this.next_id++;
            const task: Task = 
                {type:'compute-envelope', signal, fs, f_min, f_max, task_id}

            const result_promise: PromiseWithResolve<Float32Array|Error> =
                create_promise_to_promise<Float32Array|Error>()
            this.queue.push({
                task,
                worker:        undefined,
                start_resolve: promise_resolve,
                result_promise,
            })
            this.run_next()
        } )
    }

    compute_band_power_ratio(
        signal:           Float32Array, 
        fs:               number, 
        window:           number,
        numerator_band:   FrequencyBand,
        denominator_band: FrequencyBand,
    ): Promise<{promise: Promise<Float32Array|Error>}> {
        return new Promise( (promise_resolve) => {
            const task_id:number = this.next_id++;
            const task: Task = {
                type:'band-power-ratio', 
                signal, 
                fs, 
                window,
                numerator_band,
                denominator_band,
                task_id, 
            }

            const result_promise: PromiseWithResolve<Float32Array|Error> =
                create_promise_to_promise<Float32Array|Error>()
            this.queue.push({
                task,
                worker:        undefined,
                start_resolve: promise_resolve,
                result_promise,
            })
            this.run_next()
        } )
    }



    

    workers: WorkerWithBusyFlag[] = []
    pending: Record<number, Job> = {}
    queue:   Job[] = []

    on_worker_message = (event: MessageEvent) => {
        const message: WorkerResult = event.data

        const job: Job|undefined = this.pending[message.task_id]
        if(message.type == 'compute-envelope')
            job?.result_promise?.resolve(message.envelope)
        else if(message.type == 'band-power-ratio')
            job?.result_promise?.resolve(message.ratio)
        else
            console.error('Received unknown worker result: ', message)

        if(job?.worker != undefined)
            job.worker.busy = false
        if (job)
            delete this.pending[message.task_id]

        this.run_next()
    }

    on_worker_error = (event: ErrorEvent) => {
        console.log('WORKER ERROR:', event)
        for (const [task_id, job] of Object.entries(this.pending)) {
            if (job.worker?.worker === event.target) {
                job.result_promise.resolve(new Error(event.message))
                delete this.pending[Number(task_id)]
            }
        }
        this.run_next()
    }

    run_next() {
        const worker: WorkerWithBusyFlag|undefined = this.workers.find(w => !w.busy);
        if(worker == undefined)
            return;

        if(this.queue.length == 0)
            return;

        const job:Job   = this.queue.shift()!
        const task:Task = job.task
        this.pending[task.task_id] = {...job, worker}

        worker.busy = true;
        worker.worker.postMessage(task)
        job.start_resolve({promise:job.result_promise.promise})
    }

    next_id = 1;
}



type WorkerWithBusyFlag = {
    worker: Worker;
    busy:   boolean;
}


type ComputeEnvelopeJob = {
    task:    ComputeEnvelopeTask;
    worker:  WorkerWithBusyFlag|undefined;
    
    start_resolve:  (result:{promise:Promise<Float32Array|Error>}) => void;
    result_promise: PromiseWithResolve<Float32Array|Error>;
}

type ComputeBandPowerRatioJob = {
    task:    ComputeBandPowerRatioTask;
    worker:  WorkerWithBusyFlag|undefined;
    
    start_resolve:  (result:{promise:Promise<Float32Array|Error>}) => void;
    result_promise: PromiseWithResolve<Float32Array|Error>;
}

type Job = ComputeEnvelopeJob | ComputeBandPowerRatioJob;



function get_worker_url(): URL {
    const ending:'.ts'|'.ts.js' = 
        is_deno()
        ? '.ts'
        : '.ts.js';
    return new URL('./worker'+ending, import.meta.url)
}



type PromiseWithResolve<T> = {
    promise: Promise<T>;
    resolve: (result:T) => void;
}


function create_promise_to_promise<T>(): PromiseWithResolve<T> {
    let resolve: (value:T) => void = () => undefined
    const promise: Promise<T> = new Promise((promise_resolve) => {
        resolve = promise_resolve
    })
    return {promise, resolve}
}
