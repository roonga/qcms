/**
 * Shared response shapes the scenarios read (task 027). These mirror the slices'
 * response schemas at the field level the suite asserts on — a consumer's view,
 * not an import of the slice's Zod types.
 */

/** `POST /sessions` success body. */
export interface StartBody {
  sessionId: string;
  sessionToken: string;
  formVersion: number;
  expiresAt: string;
}

/** `GET /sessions/{id}/step` and `POST /sessions/{id}/answers` success body. */
export interface StepBody {
  step: { stepId: string; root: unknown } | null;
  a2uiSpecVersion: string;
  flowState: {
    currentStep: string | null;
    visibleQuestions: string[];
    missingRequired: string[];
    readyToSubmit: boolean;
  };
  progress: { stepIndex: number; totalVisibleSteps: number };
}

/** `POST /sessions/{id}/submit` success body. */
export interface Receipt {
  submittedAt: string;
  contentHash: string;
}

/** The error envelope every failure carries. */
export interface ErrBody {
  error: { code: string; message: string; details?: unknown };
}
