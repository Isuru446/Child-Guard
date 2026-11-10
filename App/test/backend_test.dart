import 'dart:convert';

import 'package:final_project/core/backend.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class MemoryTokens implements TokenStore {
  String? token;
  @override
  Future<String?> read() async => token;
  @override
  Future<void> write(String value) async {
    token = value;
  }

  @override
  Future<void> delete() async {
    token = null;
  }
}

void main() {
  test('release configuration requires HTTPS and forbids URL credentials', () {
    expect(
      () => BackendConfig.validate('http://example.com', production: true),
      throwsA(isA<ApiFailure>()),
    );
    expect(
      () => BackendConfig.validate('https://user:secret@example.com'),
      throwsA(isA<ApiFailure>()),
    );
    expect(BackendConfig.validate('https://example.com').scheme, 'https');
  });
  test(
    'login verifies selected role, stores token, attaches Bearer and logs out',
    () async {
      final store = MemoryTokens();
      final api = ApiClient(
        client: MockClient((request) async {
          if (request.url.path.endsWith('/login')) {
            expect(jsonDecode(request.body)['password'], ' private password ');
            expect(request.headers.containsKey('Authorization'), false);
            return http.Response(
              jsonEncode({
                'data': {
                  'token': 'test-jwt',
                  'user': {'id': 'p', 'role': 'PARENT'},
                },
              }),
              200,
            );
          }
          expect(request.headers['Authorization'], 'Bearer test-jwt');
          return http.Response('{"data":[]}', 200);
        }),
      );
      final session = BackendSession(api: api, store: store);
      await session.login('parent', ' private password ', 'PARENT');
      expect(store.token, 'test-jwt');
      expect(session.signedIn, true);
      await api.request('/api/v1/mobile/children');
      await session.logout();
      expect(store.token, isNull);
      expect(session.signedIn, false);
      await expectLater(
        session.login('parent', ' private password ', 'TEACHER'),
        throwsA(isA<ApiFailure>()),
      );
      expect(session.signedIn, false);
      expect(store.token, isNull);
      api.close();
    },
  );
  test(
    'expired session clears token and never retries unauthorized reads',
    () async {
      var calls = 0;
      final store = MemoryTokens()..token = 'expired';
      final api = ApiClient(
        client: MockClient((_) async {
          calls++;
          return http.Response('{"error":{"message":"Sign in required"}}', 401);
        }),
      )..token = 'expired';
      final session = BackendSession(api: api, store: store);
      await expectLater(
        api.request('/api/v1/auth/me'),
        throwsA(isA<ApiFailure>()),
      );
      expect(calls, 1);
      expect(store.token, isNull);
      expect(session.signedIn, false);
      api.close();
    },
  );
  test('safe reads retry network failure once; login never retries', () async {
    var calls = 0;
    final api = ApiClient(
      client: MockClient((_) async {
        calls++;
        throw http.ClientException('offline');
      }),
    );
    await expectLater(
      api.request('/api/v1/auth/me', authenticated: false),
      throwsA(isA<ApiFailure>()),
    );
    expect(calls, 2);
    calls = 0;
    await expectLater(
      api.request('/api/v1/auth/login', method: 'POST', authenticated: false),
      throwsA(isA<ApiFailure>()),
    );
    expect(calls, 1);
    api.close();
  });
  test('timeout and malformed responses produce useful failures', () async {
    final api = ApiClient(
      timeout: const Duration(milliseconds: 5),
      client: MockClient((_) async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        return http.Response('{"data":[]}', 200);
      }),
    );
    await expectLater(
      api.request('/api/health', authenticated: false),
      throwsA(isA<ApiFailure>()),
    );
    api.close();
    final malformed = ApiClient(
      client: MockClient((_) async => http.Response('not JSON', 502)),
    );
    await expectLater(
      malformed.request('/api/health', authenticated: false),
      throwsA(isA<ApiFailure>()),
    );
    malformed.close();
  });
}
