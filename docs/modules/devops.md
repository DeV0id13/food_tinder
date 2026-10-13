# DevOps: CI, pre-commit, типизация и безопасность (FT-07)

## Назначение

Инфраструктурная задача FT-07: быстрые проверки перед коммитом,
обязательные проверки на каждом PR в `master`, защита от секретов и уязвимостей.
Продуктовый код модулей не входит в эту задачу.

## Состав инструментов

| Инструмент | Назначение | Версия/закрепление |
| --- | --- | --- |
| pre-commit | Локальные hooks | см. `pyproject.toml` (dev-группа) |
| Ruff | Линт и формат Python | `pyproject.toml`; hook — тот же тег |
| mypy + django-stubs + drf-stubs | Типизация | `pyproject.toml` (dev-группа) |
| Gitleaks | Секреты | `.github/security/gitleaks.toml`, закреплённая ревизия |
| Semgrep CE | SAST | `.github/security/semgrep/`, закреплённые правила |
| Trivy | Уязвимости образа | `.github/security/trivy.yaml`, закреплённая версия |

> **ВНИМАНИЕ.** Версии `pre-commit`, `mypy`, `django-stubs`, `djangorestframework-stubs`,
> `gitleaks`, `semgrep`, `trivy` и commit SHA для GitHub Actions **требуют ручной
> проверки перед merge**. См. раздел «Что проверить перед merge».

## Локальная установка

### Windows / PowerShell

```powershell
python -m pip install "pip>=25.1"
python -m pip install --group dev
pre-commit install
pre-commit run --all-files
