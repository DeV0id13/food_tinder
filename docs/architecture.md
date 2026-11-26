# Архитектура FoodTinder

Production использует один origin. Caddy принимает HTTP или HTTPS, обслуживает
frontend и передаёт `/api/*` и `/admin*` Django. Django Admin использует те же
модели и механизм сессий. PostgreSQL хранит прикладные данные, сессии и временные
счётчики входа и регистрации.

```mermaid
flowchart LR
    browser["Браузер · vanilla JS"] --> caddy["Caddy · proxy"]
    caddy --> spa["HTML, JS и CSS из frontend-образа"]
    caddy --> static["staticfiles · Admin и API UI"]
    caddy --> media["recipe_photos · /media/recipes/"]
    caddy -->|"API и Admin"| django
    subgraph django["Gunicorn · Django/DRF"]
        accounts["accounts · пользователи и сессии"]
        catalog["catalog · рецепты и ингредиенты"]
        preferences["preferences · лента, свайпы и закладки"]
        planning["planning · рационы и слоты"]
        shopping["shopping · расчёт, отметки и экспорт"]
        preferences -->|"читает рецепты"| catalog
        planning -->|"читает избранное"| preferences
        planning -->|"читает рецепты"| catalog
        shopping -->|"читает рацион"| planning
        shopping -->|"читает состав"| catalog
        planning -.->|"plan_slots_changed"| shopping
    end
    django -->|"ORM и транзакции"| postgres[("PostgreSQL · postgres_data")]
    django -->|"collectstatic в deploy"| static
    django -->|"загрузка фото в Admin"| media
    subgraph monitoring["Профиль monitoring на той же VM"]
        node["node_exporter · ресурсы Linux"]
        prom[("Prometheus · prometheus_data")]
        graf["Grafana · loopback / SSH"]
        prom -->|"scrape"| node
        graf -->|"PromQL"| prom
    end
    prom -->|"внутренний HTTP · весь трафик"| caddy
    prom -->|"внутренний HTTP · Django API и readiness"| django
```

Каждое Django-приложение изменяет принадлежащие ему данные. Shopping обновляет
свои отметки в ответ на сигнал planning. Связи и ограничения описаны в
[ER-диаграмме](data-model.md).

## Сохранение рациона

```mermaid
sequenceDiagram
    actor U as Пользователь
    participant F as Frontend · черновик
    participant P as Django · planning
    participant D as PostgreSQL
    participant S as Django · shopping

    U->>F: Выбрать дни, блюда и порции
    F->>F: Автоподбор из загруженного избранного
    F->>F: Записать черновик в sessionStorage
    U->>F: Сохранить
    F->>P: POST с creation_key или PUT с version
    P->>D: Открыть транзакцию и взять блокировку пользователя или плана
    P->>D: Проверить доступность блюд и применить набор слотов
    opt Сохранённый набор слотов изменился
        P->>S: plan_slots_changed в той же транзакции
        S->>D: Удалить только устаревшие отметки
    end
    alt Сохранение или допустимый повтор
        P->>D: COMMIT
        P-->>F: План с текущей версией
    else Конфликт ключа или версии
        P->>D: ROLLBACK
        P-->>F: HTTP 409
        F->>F: Сохранить черновик
    end
    U->>F: Открыть покупки
    F->>S: GET shopping-list с plan_id
    S->>D: Прочитать сохранённые слоты, состав и отметки
    S-->>F: Суммы, округлённые вверх после суммирования
```

У нового плана нет прежних отметок. Повтор POST с тем же ключом и содержимым
возвращает первоначальный план. PUT с предыдущей версией допускает повтор только
при совпадении применённого состояния. Подробности в [planning](modules/planning.md)
и [shopping](modules/shopping.md).
