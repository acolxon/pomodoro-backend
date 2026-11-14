# Realtime и общий Pomodoro

Socket.IO подключается к тому же origin, что и HTTP API. Передайте access JWT в `auth.token`:

```ts
const socket = io(API_URL, { auth: { token: accessToken } });
```

## События клиента

Все события ниже принимают `{ roomId: string }`.

- `room:join` — проверить членство и подписаться на комнату. Сервер отправляет `room:snapshot` с комнатой, участниками, состоянием Pomodoro и `serverTime`.
- `room:leave` — отписаться от канала комнаты.
- `pomodoro:start` — владелец запускает 25-минутный Focus из состояния `idle`.
- `pomodoro:pause` — владелец ставит активную фазу на паузу.
- `pomodoro:resume` — владелец продолжает паузу.
- `pomodoro:cancel` — владелец сбрасывает таймер в `idle`.

Управление доступно только владельцу комнаты. Socket должен предварительно выполнить `room:join`.

## События сервера

- `realtime:ready` — JWT принят.
- `realtime:error` — ошибка подключения/аутентификации.
- `room:snapshot` — полный снимок комнаты при входе.
- `pomodoro:state` — новое состояние таймера, отправляется всем подключённым участникам.

Состояние содержит `status`, `phase`, `durationSeconds`, `startedAt`, `endsAt`, `pausedAt`, `remainingSeconds`, `serverTime`.

Клиент не должен отправлять секундные тики. Для обратного отсчёта используйте `endsAt - serverTime`, корректируя разницу часов по `serverTime`. После reconnect снова отправьте `room:join` и используйте новый snapshot.

Focus длится 25 минут, затем автоматически начинается Break на 5 минут. После Break состояние возвращается в `idle`. `cancel` также возвращает `idle`. Состояние хранится в PostgreSQL и восстанавливается при старте backend.
