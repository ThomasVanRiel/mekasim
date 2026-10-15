// A study's runs in a module worker of the browser.
import { type FromWorker, studyWorker, type ToWorker } from "@mekasim/fit";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
};
const handle = studyWorker();
scope.onmessage = (event) => scope.postMessage(handle(event.data));
