// Public documentation links for messages that users see outside a checkout (npx, Docker, the bridge's own status
// page): repo-relative paths like `bridge/README.md` mean nothing there, so point at the files on GitHub.
export const REPO_URL = 'https://github.com/robbyczgw-cla/hermes-ui-plus';

/** `docs/WEB-APP.md#troubleshooting` → its GitHub URL (main branch). */
export function docUrl(path) {
  const [file, anchor] = String(path).replace(/^\/+/, '').split('#');
  const kind = file.endsWith('/') || !/\.[a-z]+$/i.test(file) ? 'tree' : 'blob';
  return `${REPO_URL}/${kind}/main/${file}${anchor ? `#${anchor}` : ''}`;
}
