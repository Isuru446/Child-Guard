import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/registration.dart';

import 'support/backend_fixture.dart';

void main() {
  test(
    'submission retries reuse a receipt and never use mobile JWT credentials',
    () async {
      final receipts = <String?>[];
      final api = ApiClient(
        client: MockClient((request) async {
          receipts.add(request.headers['X-Registration-Receipt']);
          expect(request.headers.containsKey('Authorization'), isFalse);
          expect(request.url.path, '/api/v1/registration');
          return http.Response(
            jsonEncode({
              'data': {'status': 'PENDING'},
            }),
            201,
          );
        }),
      );
      api.token = 'unrelated-existing-session';
      final store = MemoryTokenStore();
      final client = RegistrationClient(api: api, store: store);
      try {
        await client.submit({'role': 'TEACHER'});
        await client.submit({'role': 'TEACHER'});
        expect(receipts, hasLength(2));
        expect(receipts[0], matches(RegExp(r'^[a-f0-9]{64}$')));
        expect(receipts[0], receipts[1]);
        expect(api.token, 'unrelated-existing-session');
      } finally {
        api.close();
      }
    },
  );
  test('status and resubmission require the saved receipt', () async {
    final paths = <String>[];
    final store = MemoryTokenStore()..token = List.filled(64, 'c').join();
    final api = ApiClient(
      client: MockClient((request) async {
        paths.add(request.url.path);
        expect(request.headers['X-Registration-Receipt'], store.token);
        return http.Response('{"data":{"status":"PENDING"}}', 200);
      }),
    );
    final client = RegistrationClient(api: api, store: store);
    try {
      expect((await client.status())['status'], 'PENDING');
      await client.submit({'role': 'PARENT'}, resubmit: true);
      expect(paths, [
        '/api/v1/registration/status',
        '/api/v1/registration/resubmit',
      ]);
    } finally {
      api.close();
    }
  });
  test(
    'missing receipt never queries status by username or sends HTTP',
    () async {
      var calls = 0;
      final api = ApiClient(
        client: MockClient((_) async {
          calls++;
          return http.Response('{}', 200);
        }),
      );
      try {
        await expectLater(
          RegistrationClient(api: api, store: MemoryTokenStore()).status(),
          throwsA(isA<ApiFailure>()),
        );
        expect(calls, 0);
      } finally {
        api.close();
      }
    },
  );
  test(
    'oversized photo is rejected locally without a network request',
    () async {
      var calls = 0;
      final api = ApiClient(
        client: MockClient((_) async {
          calls++;
          return http.Response('{}', 200);
        }),
      );
      try {
        await expectLater(
          RegistrationClient(
            api: api,
            store: MemoryTokenStore(),
          ).upload(Uint8List(2 * 1024 * 1024 + 1), 'image/png'),
          throwsA(isA<ApiFailure>()),
        );
        expect(calls, 0);
      } finally {
        api.close();
      }
    },
  );
}
