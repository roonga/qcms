import { MessageScreen } from "@/components/message-screen";

/**
 * Portal root. Respondents always arrive at a form entry (`/f/:slug`) or a secure
 * link (`/l/:token`); the bare root is only a neutral landing.
 */
export default function Home() {
  return (
    <MessageScreen
      tone="neutral"
      title="QCMS"
      body="Open your questionnaire from the link you were sent."
    />
  );
}
