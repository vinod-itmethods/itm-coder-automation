import { getGitHubToken } from '../shared/secrets.js';
import { withRetry } from '../shared/retry.js';
import { logger } from '../shared/logger.js';

interface RepoInfo {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}

async function githubFetch<T>(path: string): Promise<T> {
  const token = await getGitHubToken();

  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ONEdevops-automation',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================
// Validate repo exists and is accessible
// ============================================================
export async function validateRepo(repoUrl: string): Promise<RepoInfo | null> {
  if (!repoUrl) return null;

  // Extract owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) {
    logger.warn('Could not parse GitHub repo URL', { repoUrl });
    return null;
  }

  const ownerRepo = match[1].replace(/\.git$/, '');

  try {
    const repo = await withRetry(
      () => githubFetch<RepoInfo>(`/repos/${ownerRepo}`),
      'GitHub:validateRepo'
    );

    logger.info('Repo validated', {
      repo: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
    });

    return repo;
  } catch (err) {
    logger.warn('Repo validation failed', { repoUrl, error: String(err) });
    return null;
  }
}

// ============================================================
// Normalize repo URL
// ============================================================
export function normalizeRepoUrl(input: string): string {
  if (!input) return '';

  // Already a full URL
  if (input.startsWith('https://')) return input;
  if (input.startsWith('http://')) return input.replace('http://', 'https://');

  // owner/repo format
  if (input.includes('/')) return `https://github.com/${input}`;

  // Just a repo name — assume itmethods org
  return `https://github.com/itmethods/${input}`;
}
