// Gathering a study's touches in a Node worker thread, for the command line.
import { parentPort } from "node:worker_threads";
import { gatherer, type ToGatherer } from "./worker.ts";

const handle = gatherer();
parentPort?.on("message", (message: ToGatherer) => parentPort?.postMessage(handle(message)));
