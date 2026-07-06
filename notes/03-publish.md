# Themes, Customization, and Publishing

The default package templates include reading styles, print pagination, a cover, a table of contents, a toolbar, and a GitHub Pages index page. Most note repositories only need `book.yml`.

## Multiple Themes

One build can emit multiple themed outputs:

```yaml
themes:
  - name: light
    label: "Light"
    default: true
  - name: dark
    label: "Dark"
    style:
      accent_color: "#6ea8ff"
      custom_css: "templates/theme-dark.css"
```

`templates/theme-dark.css` is built into the package. If a note repository does not have that file, the package default is used. If the local file exists, it takes precedence.

## Custom Styles

Start with CSS variables in `book.yml`:

```yaml
style:
  accent_color: "#1f6feb"
  content_width: "860px"
  base_font_size: "16px"
  print_font_size: "11pt"
  fonts:
    body: '"Noto Serif", serif'
    heading: '"Inter", sans-serif'
    code: '"JetBrains Mono", Menlo, monospace'
```

For deeper changes, add `custom_css`:

```yaml
style:
  custom_css:
    - templates/custom.css
```

## PDF Header, Footer, and Numbering

Generated PDF headers and footers are configured with three slots:

```yaml
date_format: "YYYYMMDD"

pdf:
  page_numbers:
    format: "{{page}} / {{total}}"
    count_cover: false
    count_back_cover: false
  header:
    left: "{{title}}"
    center: ""
    right: "{{date}}"
  footer:
    left: ""
    center: "{{page}} / {{total}}"
    right: "{{theme}}"
```

The `format` field also accepts shortcuts such as `x`, `x/x`, and `page-of-total`. Date presets include `YYYY-MM-DD`, `YYYYMMDD`, `YYMMDD`, `YYYY/MM/DD`, and `YY.MM.DD`.

## GitHub Actions

This repository's `.github/workflows/render.yml` builds this showcase and publishes `dist/` to GitHub Pages. npm package publishing is handled by `.github/workflows/publish.yml`.

For npm publishing, prefer Trusted Publishing over a long-lived npm token. Before release, configure a GitHub Actions Trusted Publisher in the npm package settings and point the workflow filename to `publish.yml`.

Release checklist:

1. Confirm `package.json` has the correct `name`, `version`, `repository`, and `license`.
2. Run `npm run verify` locally.
3. Commit and push to GitHub.
4. Enable Trusted Publisher in the npm package settings.
5. Create a GitHub Release to trigger publication.

## Output

A full build generates:

```text
dist/
  index.html
  handout.html
  handout.pdf
  handout.dark.html
  handout.dark.pdf
  assets/
```

`index.html` is the GitHub Pages entry point. `handout.pdf` is the official PDF. Use the PDF for printing, binding, and external distribution; use the web version for online reading and local preview.
