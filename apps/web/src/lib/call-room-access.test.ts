import { parseEventRoomId } from './call-room-access';

jest.mock('@idol/db', () => ({ prisma: {} }));

describe('parseEventRoomId', () => {
  const id = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

  it('event:{uuid} から eventId を取り出す', () => {
    expect(parseEventRoomId(`event:${id}`)).toBe(id);
  });

  it('URL エンコードされた roomId も扱える', () => {
    expect(parseEventRoomId(encodeURIComponent(`event:${id}`))).toBe(id);
  });

  it('形式が不正なら null (任意文字列のルームを作らせない)', () => {
    expect(parseEventRoomId('event:abc')).toBeNull();
    expect(parseEventRoomId(`room:${id}`)).toBeNull();
    expect(parseEventRoomId(id)).toBeNull();
    expect(parseEventRoomId(`event:${id}/../x`)).toBeNull();
  });
});
