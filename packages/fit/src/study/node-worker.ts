// A study's runs in a Node worker thread, for the command line.
import { parentPort } from "node:worker_threads";
import { studyWorker, type ToWorker } from "./worker.ts";

const handle = studyWorker();
parentPort?.on("message", (message: ToWorker) => parentPort?.postMessage(handle(message)));
