import { is_deno } from '../lib/util.ts'

import type { 
    Task,
    WorkerResult,
} from './worker.ts'
import type { FrequencyBand } from './signal-processing.ts'
import {
    type SpectrogramOutput,
    type SpectrogramFrameRange,
    type SpectrogramPlan,
} from './signal-processing-visualization.ts'



/** Pool of web workers for compute intensive tasks. Singleton. */
export class WorkerPool {
    
    public static get_instance(size?:number): WorkerPool {
        if(!WorkerPool.instance)
            WorkerPool.instance = new WorkerPool(size)
        return WorkerPool.instance
    }
    private static instance: WorkerPool|null = null;


    private constructor(size?:number) {
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
        const task_id:number = this.next_id++
        const task: Task = 
            {type:'compute-envelope', signal, fs, f_min, f_max, task_id}
        return this.enqueue_task<Float32Array>(task)
    }

    compute_band_power_ratio(
        signal:           Float32Array, 
        fs:               number, 
        window:           number,
        numerator_band:   FrequencyBand,
        denominator_band: FrequencyBand,
    ): Promise<{promise: Promise<Float32Array|Error>}> {
        const task_id:number = this.next_id++
        const task: Task = {
            type:'band-power-ratio',
            signal,
            fs,
            window,
            numerator_band,
            denominator_band,
            task_id,
        }
        return this.enqueue_task<Float32Array>(task)
    }

    compute_spectrogram_for_visualization(
        signal:      Float32Array,
        fs:          number,
        plan:        SpectrogramPlan,
        framerange?: SpectrogramFrameRange,
    ): Promise<{promise: Promise<SpectrogramOutput|Error>}> {
        const task_id:number = this.next_id++
        const task: Task = {
            type: 'compute-spectrogram',
            signal,
            fs,
            plan,
            framerange,
            task_id,
        }
        return this.enqueue_task<SpectrogramOutput>(task)
    }

    enqueue_task<T>(task:Task): Promise<{promise: Promise<T|Error>}> {
        return new Promise((promise_resolve) => {
            const result_promise: PromiseWithResolve<T|Error> =
                create_promise_to_promise<T|Error>()
            const job: Job = {
                task,
                worker: undefined,
                start_resolve: (result:{promise:Promise<unknown>}) =>
                    promise_resolve(result as {promise: Promise<T|Error>}),
                resolve_result: (result:unknown) =>
                    result_promise.resolve(result as T|Error),
                resolve_error: (error:Error) => result_promise.resolve(error),
                promise: result_promise.promise,
            }
            this.queue.push(job)
            this.run_next()
        })
    }



    

    workers: WorkerWithBusyFlag[] = []
    pending: Record<number, Job> = {}
    queue:   Job[] = []

    on_worker_message = (event: MessageEvent) => {
        const message: WorkerResult = event.data

        const job: Job|undefined = this.pending[message.task_id]
        if(job == undefined)
            console.error('Received result for unknown task: ', message)
        else if(message.type == 'compute-envelope') {
            if(job.task.type == 'compute-envelope')
                job.resolve_result(message.envelope)
        } else if(message.type == 'band-power-ratio') {
            if(job.task.type == 'band-power-ratio')
                job.resolve_result(message.ratio)
        } else if(message.type == 'compute-spectrogram') {
            if(job.task.type == 'compute-spectrogram')
                job.resolve_result(message.spectrogram)
        } else
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
                job.resolve_error(new Error(event.message))
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
        job.start_resolve({promise:job.promise})
    }

    next_id = 1;
}



type WorkerWithBusyFlag = {
    worker: Worker;
    busy:   boolean;
}


type Job = {
    task:           Task
    worker:         WorkerWithBusyFlag|undefined
    start_resolve:  (result:{promise: Promise<unknown>}) => void
    resolve_result: (result:unknown) => void
    resolve_error:  (error:Error) => void
    promise:        Promise<unknown>
}



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
