import { ShareButton } from "./ShareButton";

export function SiteFooter() {
  return (
    <footer>
      <p>Redart · reading is the commit, the note is the push.</p>
      <p><ShareButton /> · <a href="https://github.com/fetehadin/Redart" rel="noopener">Source on GitHub</a></p>
    </footer>
  );
}
