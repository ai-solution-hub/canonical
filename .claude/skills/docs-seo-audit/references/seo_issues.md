# SEO issue catalogue — KH docs site

The twelve issue types `audit_seo.py` detects, grouped by the three severity
tiers. The audit emits these; it never auto-fixes (see the ASK-before-fixing
rule in SKILL.md).

## Error tier (must fix)

| Issue             | Detection                                              |
| ----------------- | ------------------------------------------------------ |
| missing-title     | No `title` front-matter field.                         |
| missing-description | No `description` front-matter field.                 |
| duplicate-title   | The same `title` is used by two or more pages.         |

## Warning tier (should fix)

| Issue                     | Detection                                          |
| ------------------------- | -------------------------------------------------- |
| title-too-long            | `title` longer than 60 characters.                 |
| title-too-short           | `title` shorter than 10 characters.                |
| description-too-long      | `description` longer than 160 characters.          |
| description-too-short     | `description` shorter than 50 characters.          |
| image-missing-alt         | An image (`![](…)`) with empty alt text.           |
| non-descriptive-link-text | Link text like "click here", "here", "read more".  |

## Info tier (consider)

| Issue                                | Detection                                       |
| ------------------------------------ | ----------------------------------------------- |
| multiple-h1                          | More than one `# ` H1 heading in the body.      |
| thin-content                         | Body under the `--min-words` threshold (40).    |
| missing-trailing-slash-internal-link | Internal `/path` link missing its trailing `/`. |

Thresholds (`TITLE_MAX/MIN`, `DESC_MAX/MIN`, `--min-words`) are defined in
`audit_seo.py` and may be tuned as the corpus matures. New issue types belong
in both this catalogue and the script's `ISSUE_TIERS` map.
