# CI/CD

[Workflow CI](../.github/workflows/ci.yml) запускает семь проверок для PR в
`master`, push в `master` и ручного запуска.

```mermaid
flowchart TD
    pr["PR в master / ручной запуск"] --> checks
    push["Push в master"] --> checks
    subgraph checks["Семь проверок"]
        lint["lint · Ruff и pre-commit"]
        types["typecheck · mypy"]
        secrets["secrets · Gitleaks"]
        sast["sast · Semgrep"]
        backend["backend · PostgreSQL, Django, OpenAPI, pytest, coverage"]
        frontend["frontend · ESLint, Node, Vite и образ Caddy"]
        docker["docker · production Django и Trivy"]
    end
    checks --> source{"Событие"}
    source -->|"PR / ручной запуск"| review["Результаты проверок и артефакты"]
    source -->|"Push в master"| ghcr["frontend и docker публикуют проверенные образы с SHA в GHCR"]
    checks --> all{"Все семь jobs успешны на push в master"}
    ghcr --> all
    all --> approval["Обязательный reviewer окружения production"]
    approval --> deploy["Сервер скачивает web/proxy по SHA"]
    deploy --> migrate["Одноразовый web · migrate и collectstatic"]
    migrate --> services["Обновить web/proxy, сохранить PostgreSQL и тома"]
    services --> ready["Проверить статусы и readiness с повторами"]
```

В PR публикуются результаты проверок и артефакты, включая HTML/XML coverage и
отчёты Trivy. Backend выполняет pytest один раз. Production-образы публикуются
с SHA того же коммита только в jobs `frontend` и `docker` на push в `master`.
Блокирующие правила security действуют до публикации соответствующего образа,
а deploy зависит от всех семи jobs. Ручное подтверждение задаётся в GitHub
Environment `production`.

[Инструкция Yandex Cloud](deployment.md) описывает порядок обновления и условия
HTTP-проверки. [Замеры и кеши CI](ci-cd-performance.md) описывают предыдущую
оптимизацию. Еженедельное сканирование production-образа вынесено в
[security.yml](../.github/workflows/security.yml).
