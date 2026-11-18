import type { Box, MeasuredQuestion } from "../agent/builder-facts";

export const QUESTION_ATTRIBUTE = "data-qcms-question-id";

const TARGET_MIN = 24;

const TARGETS = [
  "button",
  "select",
  "textarea",
  '[role="button"]',
  'input:not([type="radio"], [type="checkbox"], [type="hidden"])',
].join(",");

function emptyBox(): Box {
  return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
}

/** The wrapper draws no box of its own (`display: contents`), so its box is its children's. */
function unionBox(wrapper: Element, origin: DOMRect, scale: number): Box | undefined {
  let box = emptyBox();
  for (const child of Array.from(wrapper.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    box = {
      left: Math.min(box.left, (rect.left - origin.left) / scale),
      top: Math.min(box.top, (rect.top - origin.top) / scale),
      right: Math.max(box.right, (rect.right - origin.left) / scale),
      bottom: Math.max(box.bottom, (rect.bottom - origin.top) / scale),
    };
  }
  return box.left === Infinity ? undefined : box;
}

function scrollsPast(element: Element): boolean {
  return element.scrollWidth > element.clientWidth + 1;
}

function clips(element: Element): boolean {
  const style = getComputedStyle(element);
  const hides = style.overflowY === "hidden" || style.overflowY === "clip";
  return hides && element.scrollHeight > element.clientHeight + 1;
}

/** Reads every question on the drawn step, in frame pixels; `scale` is the frame's zoom. */
export function measureStep(
  surface: HTMLElement,
  scale: number,
): { readonly questions: MeasuredQuestion[]; readonly pageHeight: number } {
  const origin = surface.getBoundingClientRect();
  const questions: MeasuredQuestion[] = [];
  for (const wrapper of Array.from(surface.querySelectorAll(`[${QUESTION_ATTRIBUTE}]`))) {
    const questionId = wrapper.getAttribute(QUESTION_ATTRIBUTE) ?? "";
    const box = unionBox(wrapper, origin, scale);
    if (questionId === "" || box === undefined) continue;
    const blocks = Array.from(wrapper.children);
    const labels = Array.from(wrapper.querySelectorAll("label, legend"));
    const targets = Array.from(wrapper.querySelectorAll(TARGETS));
    questions.push({
      questionId,
      box,
      overflows: blocks.some(scrollsPast),
      clipped: [...blocks, ...labels].some(clips),
      labelTruncated: labels.some(scrollsPast),
      smallTarget: targets.some((target) => {
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return rect.width / scale < TARGET_MIN || rect.height / scale < TARGET_MIN;
      }),
    });
  }
  return { questions, pageHeight: Math.round(surface.scrollHeight) };
}
