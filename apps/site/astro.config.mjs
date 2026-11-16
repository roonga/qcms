import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  site: "https://roonga.github.io",
  base: "/qcms",
  // sharp is an ignored optional dependency of this workspace, so the default image
  // service has no backend to load; nothing on this site needs image transforms.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: "QCMS",
      description:
        "QCMS is an MIT-licensed TypeScript engine for questionnaires, surveys, and registration flows with deeply conditional logic.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/roonga/qcms" }],
      editLink: { baseUrl: "https://github.com/roonga/qcms/edit/main/apps/site/" },
      components: {
        Banner: "./src/components/PreReleaseBanner.astro",
        Head: "./src/components/Head.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        ThemeSelect: "./src/components/ThemeToggle.astro",
      },
      expressiveCode: {
        themes: ["github-dark", "github-light"],
        styleOverrides: {
          borderRadius: "6px",
          borderWidth: "1px",
          codeFontFamily: "var(--sl-font-mono)",
          codeFontSize: "0.85rem",
          codeLineHeight: "1.7",
          frames: { shadowColor: "transparent" },
        },
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { slug: "start/introduction" },
            { slug: "start/quick-start" },
            { slug: "start/scaffold-an-app" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { slug: "concepts/questions" },
            { slug: "concepts/forms-and-versions" },
            { slug: "concepts/rules" },
            { slug: "concepts/sessions-and-answers" },
            { slug: "concepts/repeating-groups" },
          ],
        },
        {
          label: "Build",
          items: [
            { slug: "build/theming" },
            { slug: "build/secure-links" },
            { slug: "build/webhooks" },
            { slug: "build/export-and-reporting" },
          ],
        },
        {
          label: "Deploy and operate",
          items: [
            { slug: "deploy/docker-compose" },
            { slug: "deploy/ingress-and-tls" },
            { slug: "deploy/environments" },
            { slug: "deploy/backup-and-restore" },
            { slug: "deploy/erasure-and-retention" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/packages" },
            { slug: "reference/http-api" },
            { slug: "reference/configuration" },
          ],
        },
      ],
    }),
  ],
});
