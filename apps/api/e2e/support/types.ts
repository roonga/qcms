export interface StartBody {
  sessionId: string;
  sessionToken: string;
  formVersion: number;
  expiresAt: string;
}

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

export interface Receipt {
  submittedAt: string;
  contentHash: string;
}

export interface ErrBody {
  error: { code: string; message: string; details?: unknown };
}
