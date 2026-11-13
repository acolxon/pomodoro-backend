import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, RegisteredUser, registerUser, resetData } from './utils/test-app';

interface RoomBody {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  maxMembers: number;
  membersCount: number;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
}

interface MemberBody {
  userId: string;
  username: string;
  avatarUrl: string | null;
  level: number;
  role: 'owner' | 'member';
  joinedAt: string;
}

const INVITE_CODE_FORMAT = /^[A-HJ-NP-Z2-9]{8}$/;
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

describe('Rooms (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
  });

  beforeEach(async () => {
    await resetData(ds);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- помощники ------------------------------------------------------------

  const as = (user: RegisteredUser) => ({ Authorization: `Bearer ${user.token}` });

  const createRoomReq = (user: RegisteredUser, body: Record<string, unknown> = { name: 'Focus' }) =>
    http().post('/rooms').set(as(user)).send(body);
  const joinReq = (user: RegisteredUser, inviteCode: string) =>
    http().post('/rooms/join').set(as(user)).send({ inviteCode });
  const leaveReq = (user: RegisteredUser) => http().post('/rooms/leave').set(as(user));
  const meReq = (user: RegisteredUser) => http().get('/rooms/me').set(as(user));
  const membersReq = (user: RegisteredUser, roomId: string) =>
    http().get(`/rooms/${roomId}/members`).set(as(user));
  const transferReq = (user: RegisteredUser, roomId: string, newOwnerId: string) =>
    http().patch(`/rooms/${roomId}/owner`).set(as(user)).send({ newOwnerId });

  async function createRoom(
    user: RegisteredUser,
    body: Record<string, unknown> = { name: 'Focus' },
  ) {
    const res = await createRoomReq(user, body).expect(201);
    return res.body as RoomBody;
  }

  async function join(user: RegisteredUser, room: RoomBody): Promise<RoomBody> {
    const res = await joinReq(user, room.inviteCode).expect(200);
    return res.body as RoomBody;
  }

  async function register(...suffixes: string[]): Promise<RegisteredUser[]> {
    const users: RegisteredUser[] = [];
    for (const suffix of suffixes) {
      users.push(await registerUser(app, suffix));
    }
    return users;
  }

  async function members(user: RegisteredUser, roomId: string): Promise<MemberBody[]> {
    const res = await membersReq(user, roomId).expect(200);
    return res.body as MemberBody[];
  }

  async function dbRoom(roomId: string) {
    const rows: Array<{ owner_id: string; status: string }> = await ds.query(
      'SELECT owner_id, status FROM rooms WHERE id = $1',
      [roomId],
    );
    return rows[0];
  }

  async function dbMemberships(roomId: string) {
    return ds.query<Array<{ user_id: string; role: string; left_at: string | null }>>(
      'SELECT user_id, role, left_at FROM room_members WHERE room_id = $1 ORDER BY joined_at, id',
      [roomId],
    );
  }

  async function countActive(roomId: string): Promise<number> {
    const rows: Array<{ n: string }> = await ds.query(
      'SELECT count(*) AS n FROM room_members WHERE room_id = $1 AND left_at IS NULL',
      [roomId],
    );
    return Number(rows[0].n);
  }

  /** Глобальные инварианты: должны выполняться после ЛЮБОГО сценария, в том числе гоночного. */
  async function expectInvariants(): Promise<void> {
    const openWithoutOwner: unknown[] = await ds.query(`
      SELECT r.id FROM rooms r
       WHERE r.status = 'open' AND NOT EXISTS (
         SELECT 1 FROM room_members m
          WHERE m.room_id = r.id AND m.user_id = r.owner_id AND m.role = 'owner' AND m.left_at IS NULL)`);
    const closedWithActive: unknown[] = await ds.query(`
      SELECT r.id FROM rooms r
       WHERE r.status = 'closed'
         AND EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.left_at IS NULL)`);
    const overCapacity: unknown[] = await ds.query(`
      SELECT r.id FROM rooms r
       WHERE (SELECT count(*) FROM room_members m WHERE m.room_id = r.id AND m.left_at IS NULL) > r.max_members`);
    const multiActive: unknown[] = await ds.query(
      'SELECT user_id FROM room_members WHERE left_at IS NULL GROUP BY user_id HAVING count(*) > 1',
    );
    const multiOwner: unknown[] = await ds.query(
      `SELECT room_id FROM room_members WHERE role = 'owner' AND left_at IS NULL GROUP BY room_id HAVING count(*) > 1`,
    );
    expect(openWithoutOwner).toEqual([]);
    expect(closedWithActive).toEqual([]);
    expect(overCapacity).toEqual([]);
    expect(multiActive).toEqual([]);
    expect(multiOwner).toEqual([]);
  }

  // --- авторизация -----------------------------------------------------------

  describe('требуют авторизации', () => {
    const cases: Array<[string, () => request.Test]> = [
      ['POST /rooms', () => http().post('/rooms').send({ name: 'x' })],
      ['POST /rooms/join', () => http().post('/rooms/join').send({ inviteCode: 'AAAAAAAA' })],
      ['POST /rooms/leave', () => http().post('/rooms/leave')],
      ['GET /rooms/me', () => http().get('/rooms/me')],
      ['GET /rooms/:id', () => http().get(`/rooms/${UNKNOWN_UUID}`)],
      ['GET /rooms/:id/members', () => http().get(`/rooms/${UNKNOWN_UUID}/members`)],
      [
        'PATCH /rooms/:id/owner',
        () => http().patch(`/rooms/${UNKNOWN_UUID}/owner`).send({ newOwnerId: UNKNOWN_UUID }),
      ],
    ];

    it.each(cases)('%s без токена → 401 UNAUTHORIZED', async (_name, make) => {
      const res = await make().expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('с невалидным токеном → 401', async () => {
      await http().get('/rooms/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('запрос без токена не создаёт комнат', async () => {
      await http().post('/rooms').send({ name: 'x' }).expect(401);
      const rows: unknown[] = await ds.query('SELECT 1 FROM rooms');
      expect(rows).toHaveLength(0);
    });
  });

  // --- POST /rooms -----------------------------------------------------------

  describe('POST /rooms', () => {
    it('создаёт комнату: создатель — владелец и единственный участник', async () => {
      const [alice] = await register('a');
      const res = await createRoomReq(alice, { name: 'Deep Work' }).expect(201);
      const room = res.body as RoomBody;

      expect(room).toEqual({
        id: expect.any(String),
        name: 'Deep Work',
        ownerId: alice.id,
        inviteCode: expect.stringMatching(INVITE_CODE_FORMAT),
        maxMembers: 10,
        membersCount: 1,
        status: 'open',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      expect(await dbRoom(room.id)).toEqual({ owner_id: alice.id, status: 'open' });
      expect(await dbMemberships(room.id)).toEqual([
        { user_id: alice.id, role: 'owner', left_at: null },
      ]);
      await expectInvariants();
    });

    it('принимает maxMembers и обрезает пробелы в названии', async () => {
      const [alice] = await register('a');
      const room = await createRoom(alice, { name: '  Sprint  ', maxMembers: 3 });
      expect(room.name).toBe('Sprint');
      expect(room.maxMembers).toBe(3);
    });

    it('коды приглашения разных комнат различаются', async () => {
      const [a, b] = await register('a', 'b');
      const first = await createRoom(a);
      const second = await createRoom(b);
      expect(first.inviteCode).not.toBe(second.inviteCode);
    });

    it.each([
      ['пустое название', { name: '' }],
      ['название длиннее 50 символов', { name: 'x'.repeat(51) }],
      ['нет названия', {}],
      ['maxMembers = 1', { name: 'r', maxMembers: 1 }],
      ['maxMembers = 51', { name: 'r', maxMembers: 51 }],
      ['maxMembers не целое', { name: 'r', maxMembers: 2.5 }],
      ['клиент пытается задать ownerId', { name: 'r', ownerId: UNKNOWN_UUID }],
      ['клиент пытается задать inviteCode', { name: 'r', inviteCode: 'AAAAAAAA' }],
      ['клиент пытается задать status', { name: 'r', status: 'closed' }],
    ])('невалидное тело (%s) → 400 VALIDATION_ERROR', async (_title, body) => {
      const [alice] = await register('a');
      const res = await createRoomReq(alice, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      const rows: unknown[] = await ds.query('SELECT 1 FROM rooms');
      expect(rows).toHaveLength(0);
    });

    it('нельзя создать комнату, пока состоишь в другой → 409 ALREADY_IN_ROOM', async () => {
      const [alice] = await register('a');
      await createRoom(alice);

      const res = await createRoomReq(alice, { name: 'Second' }).expect(409);
      expect(res.body.code).toBe('ALREADY_IN_ROOM');

      const rooms: unknown[] = await ds.query('SELECT 1 FROM rooms');
      expect(rooms).toHaveLength(1); // неудачное создание не оставляет «осиротевшую» комнату
    });

    it('участник чужой комнаты тоже не может создать свою', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await createRoomReq(bob, { name: 'Mine' }).expect(409);
      expect(res.body.code).toBe('ALREADY_IN_ROOM');
    });

    it('после выхода можно создать новую комнату', async () => {
      const [alice] = await register('a');
      await createRoom(alice);
      await leaveReq(alice).expect(200);
      const second = await createRoom(alice, { name: 'Again' });
      expect(second.name).toBe('Again');
      await expectInvariants();
    });
  });

  // --- POST /rooms/join ------------------------------------------------------

  describe('POST /rooms/join', () => {
    it('несколько пользователей вступают в комнату', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);

      const afterBob = await join(bob, room);
      expect(afterBob).toMatchObject({ id: room.id, ownerId: alice.id, membersCount: 2 });
      const afterCarol = await join(carol, room);
      expect(afterCarol.membersCount).toBe(3);

      const list = await members(alice, room.id);
      expect(list.map((m) => [m.userId, m.role])).toEqual([
        [alice.id, 'owner'],
        [bob.id, 'member'],
        [carol.id, 'member'],
      ]);
      expect(list[1]).toEqual({
        userId: bob.id,
        username: bob.username,
        avatarUrl: null,
        level: 1,
        role: 'member',
        joinedAt: expect.any(String),
      });
      await expectInvariants();
    });

    it('код принимается без учёта регистра и пробелов по краям', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);

      const res = await joinReq(bob, `  ${room.inviteCode.toLowerCase()} `).expect(200);
      expect((res.body as RoomBody).id).toBe(room.id);
    });

    it('неизвестный код → 404 INVALID_INVITE_CODE', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      const unknown = room.inviteCode === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA';

      const res = await joinReq(bob, unknown).expect(404);
      expect(res.body.code).toBe('INVALID_INVITE_CODE');
    });

    it.each(['short', 'AAAAAAA0', 'ILLEGALS', 'AAAA AAAA'])(
      'код неверного формата %j → 404 INVALID_INVITE_CODE',
      async (code) => {
        const [bob] = await register('b');
        const res = await joinReq(bob, code).expect(404);
        expect(res.body.code).toBe('INVALID_INVITE_CODE');
      },
    );

    it('пустое тело → 400 VALIDATION_ERROR', async () => {
      const [bob] = await register('b');
      const res = await http().post('/rooms/join').set(as(bob)).send({}).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('заполненная комната → 409 ROOM_FULL, состав не меняется', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice, { name: 'Duo', maxMembers: 2 });
      await join(bob, room);

      const res = await joinReq(carol, room.inviteCode).expect(409);
      expect(res.body.code).toBe('ROOM_FULL');
      expect(await countActive(room.id)).toBe(2);
      await meReq(carol).expect(404);
    });

    it('место освобождается после выхода участника', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice, { name: 'Duo', maxMembers: 2 });
      await join(bob, room);
      await joinReq(carol, room.inviteCode).expect(409);

      await leaveReq(bob).expect(200);
      const joined = await join(carol, room);
      expect(joined.membersCount).toBe(2);
    });

    it('повторное вступление в ту же комнату → 409 ALREADY_IN_ROOM', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await joinReq(bob, room.inviteCode).expect(409);
      expect(res.body.code).toBe('ALREADY_IN_ROOM');
      expect(await countActive(room.id)).toBe(2);
    });

    it('владелец не может вступить в собственную комнату повторно', async () => {
      const [alice] = await register('a');
      const room = await createRoom(alice);
      const res = await joinReq(alice, room.inviteCode).expect(409);
      expect(res.body.code).toBe('ALREADY_IN_ROOM');
    });

    it('нельзя состоять в двух комнатах одновременно → 409 ALREADY_IN_ROOM', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const roomA = await createRoom(alice, { name: 'A' });
      const roomB = await createRoom(bob, { name: 'B' });
      await join(carol, roomA);

      const res = await joinReq(carol, roomB.inviteCode).expect(409);
      expect(res.body.code).toBe('ALREADY_IN_ROOM');

      // Остаётся в первой комнате
      expect(((await meReq(carol).expect(200)).body as RoomBody).id).toBe(roomA.id);
      expect(await countActive(roomB.id)).toBe(1);
      await expectInvariants();
    });

    it('можно вступить в другую комнату после выхода из первой', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const roomA = await createRoom(alice, { name: 'A' });
      const roomB = await createRoom(bob, { name: 'B' });
      await join(carol, roomA);
      await leaveReq(carol).expect(200);

      await join(carol, roomB);
      expect(((await meReq(carol).expect(200)).body as RoomBody).id).toBe(roomB.id);
    });

    it('повторное вступление после выхода: создаётся новое участие, история сохраняется', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);

      await join(bob, room);
      await leaveReq(bob).expect(200);
      await join(bob, room);

      const rows = await dbMemberships(room.id);
      const bobRows = rows.filter((r) => r.user_id === bob.id);
      expect(bobRows).toHaveLength(2);
      expect(bobRows[0].left_at).not.toBeNull(); // прошлое участие закрыто
      expect(bobRows[1].left_at).toBeNull(); // текущее активно
      expect(await members(alice, room.id)).toHaveLength(2);
      await expectInvariants();
    });

    it('в закрытую комнату вступить нельзя → 409 ROOM_CLOSED', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await leaveReq(alice).expect(200); // единственный участник вышел — комната закрыта

      const res = await joinReq(bob, room.inviteCode).expect(409);
      expect(res.body.code).toBe('ROOM_CLOSED');
      expect(await countActive(room.id)).toBe(0);
    });
  });

  // --- POST /rooms/leave -----------------------------------------------------

  describe('POST /rooms/leave', () => {
    it('участник выходит: комната и владелец остаются', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await leaveReq(bob).expect(200);
      expect(res.body).toEqual({ roomId: room.id, roomClosed: false, newOwnerId: null });

      await meReq(bob).expect(404);
      expect(await members(alice, room.id)).toHaveLength(1);
      expect(await dbRoom(room.id)).toEqual({ owner_id: alice.id, status: 'open' });

      // Участие закрыто, а не удалено
      const bobRows = (await dbMemberships(room.id)).filter((r) => r.user_id === bob.id);
      expect(bobRows).toHaveLength(1);
      expect(bobRows[0].left_at).not.toBeNull();
      await expectInvariants();
    });

    it('вышедший теряет доступ к комнате', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);
      await leaveReq(bob).expect(200);

      const res = await http().get(`/rooms/${room.id}`).set(as(bob)).expect(403);
      expect(res.body.code).toBe('NOT_IN_ROOM');
      await membersReq(bob, room.id).expect(403);
    });

    it('без комнаты → 404 NOT_IN_ROOM', async () => {
      const [alice] = await register('a');
      const res = await leaveReq(alice).expect(404);
      expect(res.body.code).toBe('NOT_IN_ROOM');
    });

    it('повторный выход → 404 NOT_IN_ROOM', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);
      await leaveReq(bob).expect(200);

      const res = await leaveReq(bob).expect(404);
      expect(res.body.code).toBe('NOT_IN_ROOM');
    });

    it('выход владельца передаёт права самому раннему активному участнику', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room); // вступил первым
      await join(carol, room);

      const res = await leaveReq(alice).expect(200);
      expect(res.body).toEqual({ roomId: room.id, roomClosed: false, newOwnerId: bob.id });

      expect(await dbRoom(room.id)).toEqual({ owner_id: bob.id, status: 'open' });
      const list = await members(bob, room.id);
      expect(list.map((m) => [m.userId, m.role])).toEqual([
        [bob.id, 'owner'],
        [carol.id, 'member'],
      ]);
      const info = (await http().get(`/rooms/${room.id}`).set(as(bob)).expect(200))
        .body as RoomBody;
      expect(info).toMatchObject({ ownerId: bob.id, membersCount: 2, status: 'open' });
      await expectInvariants();
    });

    it('«самый ранний» выбирается среди активных: вышедший и вернувшийся становится последним', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);
      await join(carol, room);

      await leaveReq(bob).expect(200);
      await join(bob, room); // теперь Боб вступил позже Кэрол

      const res = await leaveReq(alice).expect(200);
      expect((res.body as { newOwnerId: string }).newOwnerId).toBe(carol.id);
      expect((await dbRoom(room.id)).owner_id).toBe(carol.id);
      await expectInvariants();
    });

    it('новый владелец получает права управления, прежний — теряет', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);
      await join(carol, room);
      await leaveReq(alice).expect(200); // владелец — Боб

      // Боб может передать права, Кэрол — нет
      const denied = await transferReq(carol, room.id, carol.id).expect(403);
      expect(denied.body.code).toBe('NOT_ROOM_OWNER');
      await transferReq(bob, room.id, carol.id).expect(200);
    });

    it('когда выходит последний участник, комната закрывается', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      await leaveReq(alice).expect(200); // владелец — Боб
      const res = await leaveReq(bob).expect(200);

      expect(res.body).toEqual({ roomId: room.id, roomClosed: true, newOwnerId: null });
      expect((await dbRoom(room.id)).status).toBe('closed');
      expect(await countActive(room.id)).toBe(0);
      await expectInvariants();
    });

    it('единственный владелец выходит: комната закрывается, он может создать новую', async () => {
      const [alice] = await register('a');
      const room = await createRoom(alice);

      const res = await leaveReq(alice).expect(200);
      expect(res.body).toEqual({ roomId: room.id, roomClosed: true, newOwnerId: null });
      expect((await dbRoom(room.id)).status).toBe('closed');
      await meReq(alice).expect(404);

      const second = await createRoom(alice, { name: 'New' });
      expect(second.id).not.toBe(room.id);
      expect(second.inviteCode).not.toBe(room.inviteCode);
      await expectInvariants();
    });

    it('закрытая комната недоступна даже бывшим участникам', async () => {
      const [alice] = await register('a');
      const room = await createRoom(alice);
      await leaveReq(alice).expect(200);

      await http().get(`/rooms/${room.id}`).set(as(alice)).expect(403);
    });
  });

  // --- GET /rooms/me, /rooms/:id, /rooms/:id/members -------------------------

  describe('GET /rooms/me', () => {
    it('возвращает текущую комнату', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await meReq(bob).expect(200);
      expect(res.body).toMatchObject({ id: room.id, ownerId: alice.id, membersCount: 2 });
    });

    it('нет комнаты → 404 NOT_IN_ROOM', async () => {
      const [alice] = await register('a');
      const res = await meReq(alice).expect(404);
      expect(res.body.code).toBe('NOT_IN_ROOM');
    });

    it('«me» не воспринимается как :id', async () => {
      const [alice] = await register('a');
      const res = await meReq(alice).expect(404);
      expect(res.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /rooms/:id', () => {
    it('участник видит информацию о комнате, включая код приглашения', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice, { name: 'Info', maxMembers: 4 });
      await join(bob, room);

      for (const user of [alice, bob]) {
        const res = await http().get(`/rooms/${room.id}`).set(as(user)).expect(200);
        expect(res.body).toMatchObject({
          id: room.id,
          name: 'Info',
          ownerId: alice.id,
          inviteCode: room.inviteCode,
          maxMembers: 4,
          membersCount: 2,
          status: 'open',
        });
      }
    });

    it('не участник → 403 NOT_IN_ROOM (код приглашения не раскрывается)', async () => {
      const [alice, outsider] = await register('a', 'x');
      const room = await createRoom(alice);

      const res = await http().get(`/rooms/${room.id}`).set(as(outsider)).expect(403);
      expect(res.body.code).toBe('NOT_IN_ROOM');
      expect(JSON.stringify(res.body)).not.toContain(room.inviteCode);
    });

    it('несуществующая комната → 404 ROOM_NOT_FOUND', async () => {
      const [alice] = await register('a');
      const res = await http().get(`/rooms/${UNKNOWN_UUID}`).set(as(alice)).expect(404);
      expect(res.body.code).toBe('ROOM_NOT_FOUND');
    });

    it('некорректный UUID → 400 VALIDATION_ERROR', async () => {
      const [alice] = await register('a');
      const res = await http().get('/rooms/not-a-uuid').set(as(alice)).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /rooms/:id/members', () => {
    it('возвращает только активных участников в порядке вступления', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);
      await join(carol, room);
      await leaveReq(bob).expect(200);

      const list = await members(carol, room.id);
      expect(list.map((m) => m.userId)).toEqual([alice.id, carol.id]);
      expect(list.map((m) => m.role)).toEqual(['owner', 'member']);
    });

    it('не раскрывает email, Coins и другие данные пользователей', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await membersReq(alice, room.id).expect(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(bob.email);
      expect(text).not.toContain('coins');
      expect(text).not.toContain('passwordHash');
    });

    it('не участник → 403 NOT_IN_ROOM', async () => {
      const [alice, outsider] = await register('a', 'x');
      const room = await createRoom(alice);
      const res = await membersReq(outsider, room.id).expect(403);
      expect(res.body.code).toBe('NOT_IN_ROOM');
    });

    it('несуществующая комната → 404 ROOM_NOT_FOUND', async () => {
      const [alice] = await register('a');
      const res = await membersReq(alice, UNKNOWN_UUID).expect(404);
      expect(res.body.code).toBe('ROOM_NOT_FOUND');
    });
  });

  // --- PATCH /rooms/:id/owner ------------------------------------------------

  describe('PATCH /rooms/:id/owner', () => {
    it('владелец передаёт права участнику', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await transferReq(alice, room.id, bob.id).expect(200);
      expect(res.body).toMatchObject({ id: room.id, ownerId: bob.id, membersCount: 2 });

      expect(await dbRoom(room.id)).toEqual({ owner_id: bob.id, status: 'open' });
      const list = await members(alice, room.id);
      expect(list.map((m) => [m.userId, m.role])).toEqual([
        [alice.id, 'member'],
        [bob.id, 'owner'],
      ]);
      await expectInvariants();
    });

    it('прежний владелец теряет права, новый может передать их обратно', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);
      await transferReq(alice, room.id, bob.id).expect(200);

      const denied = await transferReq(alice, room.id, alice.id).expect(403);
      expect(denied.body.code).toBe('NOT_ROOM_OWNER');

      await transferReq(bob, room.id, alice.id).expect(200);
      expect((await dbRoom(room.id)).owner_id).toBe(alice.id);
      await expectInvariants();
    });

    it('обычный участник не может передавать права → 403 NOT_ROOM_OWNER', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);
      await join(carol, room);

      const res = await transferReq(bob, room.id, carol.id).expect(403);
      expect(res.body.code).toBe('NOT_ROOM_OWNER');
      expect(await dbRoom(room.id)).toEqual({ owner_id: alice.id, status: 'open' });
    });

    it('участник не может назначить владельцем самого себя', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      await transferReq(bob, room.id, bob.id).expect(403);
      expect((await dbRoom(room.id)).owner_id).toBe(alice.id);
    });

    it('посторонний (не участник) → 403 NOT_ROOM_OWNER', async () => {
      const [alice, bob, outsider] = await register('a', 'b', 'x');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await transferReq(outsider, room.id, bob.id).expect(403);
      expect(res.body.code).toBe('NOT_ROOM_OWNER');
      expect((await dbRoom(room.id)).owner_id).toBe(alice.id);
    });

    it('получатель не в комнате → 404 ROOM_MEMBER_NOT_FOUND', async () => {
      const [alice, outsider] = await register('a', 'x');
      const room = await createRoom(alice);

      const res = await transferReq(alice, room.id, outsider.id).expect(404);
      expect(res.body.code).toBe('ROOM_MEMBER_NOT_FOUND');
      expect((await dbRoom(room.id)).owner_id).toBe(alice.id);
    });

    it('получатель вышел из комнаты → 404 ROOM_MEMBER_NOT_FOUND', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);
      await leaveReq(bob).expect(200);

      const res = await transferReq(alice, room.id, bob.id).expect(404);
      expect(res.body.code).toBe('ROOM_MEMBER_NOT_FOUND');
    });

    it('получатель — участник ДРУГОЙ комнаты → 404 ROOM_MEMBER_NOT_FOUND', async () => {
      const [alice, bob] = await register('a', 'b');
      const roomA = await createRoom(alice, { name: 'A' });
      await createRoom(bob, { name: 'B' });

      const res = await transferReq(alice, roomA.id, bob.id).expect(404);
      expect(res.body.code).toBe('ROOM_MEMBER_NOT_FOUND');
    });

    it('передача самому себе → 400 BAD_REQUEST', async () => {
      const [alice] = await register('a');
      const room = await createRoom(alice);
      const res = await transferReq(alice, room.id, alice.id).expect(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('невалидное тело → 400 VALIDATION_ERROR', async () => {
      const [alice] = await register('a');
      const room = await createRoom(alice);

      for (const body of [{}, { newOwnerId: 'bob' }, { newOwnerId: UNKNOWN_UUID, role: 'owner' }]) {
        const res = await http()
          .patch(`/rooms/${room.id}/owner`)
          .set(as(alice))
          .send(body)
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('несуществующая комната → 404 ROOM_NOT_FOUND, некорректный UUID → 400', async () => {
      const [alice] = await register('a');
      const res = await transferReq(alice, UNKNOWN_UUID, alice.id).expect(404);
      expect(res.body.code).toBe('ROOM_NOT_FOUND');
      await http()
        .patch('/rooms/not-a-uuid/owner')
        .set(as(alice))
        .send({ newOwnerId: alice.id })
        .expect(400);
    });

    it('в закрытой комнате → 409 ROOM_CLOSED', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await leaveReq(alice).expect(200);

      const res = await transferReq(alice, room.id, bob.id).expect(409);
      expect(res.body.code).toBe('ROOM_CLOSED');
    });

    it('после передачи прав выход прежнего владельца не меняет владельца', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);
      await join(carol, room);
      await transferReq(alice, room.id, carol.id).expect(200);

      const res = await leaveReq(alice).expect(200);
      expect(res.body).toEqual({ roomId: room.id, roomClosed: false, newOwnerId: null });
      expect((await dbRoom(room.id)).owner_id).toBe(carol.id);
      await expectInvariants();
    });

    it('обновляет updated_at комнаты', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const res = await transferReq(alice, room.id, bob.id).expect(200);
      expect(new Date((res.body as RoomBody).updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(room.updatedAt).getTime(),
      );
    });
  });

  // --- Конкурентные запросы --------------------------------------------------

  describe('конкурентные запросы', () => {
    it('одновременные вступления не превышают вместимость', async () => {
      const [owner, ...others] = await register('o', '1', '2', '3', '4', '5', '6');
      const room = await createRoom(owner, { name: 'Race', maxMembers: 3 }); // свободно 2 места

      const results = await Promise.all(others.map((user) => joinReq(user, room.inviteCode)));
      const ok = results.filter((r) => r.status === 200);
      const full = results.filter((r) => r.status === 409);

      expect(ok).toHaveLength(2);
      expect(full).toHaveLength(4);
      expect(full.every((r) => r.body.code === 'ROOM_FULL')).toBe(true);
      expect(await countActive(room.id)).toBe(3);
      await expectInvariants();
    });

    it('один пользователь, одновременные вступления в две комнаты: сработает ровно одно', async () => {
      const [a, b, carol] = await register('a', 'b', 'c');
      const roomA = await createRoom(a, { name: 'A' });
      const roomB = await createRoom(b, { name: 'B' });

      const results = await Promise.all([
        joinReq(carol, roomA.inviteCode),
        joinReq(carol, roomB.inviteCode),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe('ALREADY_IN_ROOM');

      const active: Array<{ n: string }> = await ds.query(
        'SELECT count(*) AS n FROM room_members WHERE user_id = $1 AND left_at IS NULL',
        [carol.id],
      );
      expect(Number(active[0].n)).toBe(1);
      await expectInvariants();
    });

    it('один пользователь, одновременное создание комнат: создастся ровно одна', async () => {
      const [alice] = await register('a');

      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => createRoomReq(alice, { name: `Room ${i}` })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const failed = results.filter((r) => r.status !== 201);
      expect(failed.every((r) => r.status === 409 && r.body.code === 'ALREADY_IN_ROOM')).toBe(true);

      const rooms: unknown[] = await ds.query('SELECT 1 FROM rooms');
      expect(rooms).toHaveLength(1); // проигравшие транзакции полностью откатились
      await expectInvariants();
    });

    it('двойной одновременный выход одного пользователя: один 200, один 404', async () => {
      const [alice, bob] = await register('a', 'b');
      const room = await createRoom(alice);
      await join(bob, room);

      const results = await Promise.all([leaveReq(bob), leaveReq(bob)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(results.find((r) => r.status === 404)?.body.code).toBe('NOT_IN_ROOM');
      expect(await countActive(room.id)).toBe(1);
      await expectInvariants();
    });

    it('все участники выходят одновременно: комната закрывается, инварианты целы', async () => {
      const [owner, b, c, d] = await register('o', 'b', 'c', 'd');
      const room = await createRoom(owner);
      await join(b, room);
      await join(c, room);
      await join(d, room);

      const results = await Promise.all([owner, b, c, d].map((user) => leaveReq(user)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      // Ровно один из выходов закрыл комнату
      expect(results.filter((r) => (r.body as { roomClosed: boolean }).roomClosed)).toHaveLength(1);

      expect((await dbRoom(room.id)).status).toBe('closed');
      expect(await countActive(room.id)).toBe(0);
      await expectInvariants();
    });

    it('владелец одновременно выходит и передаёт права: итог всегда целостный', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);
      await join(carol, room);

      const results = await Promise.all([leaveReq(alice), transferReq(alice, room.id, carol.id)]);
      // Допустимы оба порядка; недопустимо только нарушение инвариантов и 500
      expect(results.every((r) => r.status < 500)).toBe(true);

      const owner = (await dbRoom(room.id)).owner_id;
      expect([bob.id, carol.id]).toContain(owner);
      await expectInvariants();
    });

    it('одновременные вступление и выход владельца не оставляют комнату без владельца', async () => {
      const [alice, bob, carol] = await register('a', 'b', 'c');
      const room = await createRoom(alice);
      await join(bob, room);

      const results = await Promise.all([leaveReq(alice), joinReq(carol, room.inviteCode)]);
      expect(results.every((r) => r.status < 500)).toBe(true);
      expect((await dbRoom(room.id)).status).toBe('open');
      await expectInvariants();
    });
  });
});
