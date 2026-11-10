# Upload after approval

These are instructions only. No Git repository has been initialized and no remote operation has been performed.

1. Review `README.md`, `docs/public-files.csv`, `docs/EXCLUDED_FILES.md`, `docs/CHANGES.md`, `docs/SECURITY_REVIEW.md`, `docs/VALIDATION.md` and `docs/PUBLICATION_BLOCKERS.md`.
2. Confirm ownership/license and asset permissions. Approve the exact public contents and whether the documented prototype/deployment limitations are acceptable.
3. After approval, rerun `python scripts/review-public-copy.py` from the repository root. Investigate any findings. The scan reports locations only, never secret values. Freeze the reviewed contents; regenerate the manifest after any further changes.
4. Initialize and stage only the explicit manifest list:

```powershell
# Run only after owner approval, in D:\ChildGuard-V2-GitHub
git init -b main
git add --pathspec-from-file=docs/public-paths.txt
git status --short
git diff --cached --stat
git diff --cached --check
```

Review staged contents locally before committing. Check that real `.env`, `secrets.h`, private media, backups, dependencies and `.validation` are absent. Never use force-add to bypass the ignore rules. Inspect sensitive-looking matches locally without posting values to an issue or chat. Generated manifest index files deliberately omit their own hashes to avoid circular checksums.

```powershell
git commit -m "Prepare ChildGuard V2 prototype source and documentation"
```

5. Create an empty GitHub repository using your account and chosen visibility. After explicitly approving publication, set its actual URL locally:

```powershell
git remote add origin <YOUR_APPROVED_GITHUB_REPOSITORY_URL>
git push -u origin main
```

Do not paste tokens into remote URLs or source files. Authenticate with your normal Git credential manager. Do not upload a ZIP of the entire working directory: ignored validation caches and installed dependencies are not part of the public-file manifest. No automated database deployment, firmware flashing or CI secret configuration is implied by source upload.
