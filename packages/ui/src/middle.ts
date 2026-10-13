/**
 * Keep a release of the middle button from pasting. On Linux it pastes the selected
 * text into the editor, wherever on the page the button is let go; where the middle
 * button moves the view, that must not happen. Returns what takes the guard off again.
 */
export function noMiddlePaste(element: HTMLElement): () => void {
  const stop = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };
  // Chrome pastes on the release, Firefox on the click that follows it.
  element.addEventListener("mouseup", stop);
  element.addEventListener("auxclick", stop);
  return () => {
    element.removeEventListener("mouseup", stop);
    element.removeEventListener("auxclick", stop);
  };
}
