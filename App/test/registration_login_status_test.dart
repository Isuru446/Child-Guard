import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:final_project/core/backend.dart';

import 'support/backend_fixture.dart';

void main() {
  for (final role in ['PARENT', 'TEACHER']) {
    for (final status in ['PENDING', 'REJECTED']) {
      test(
        '$role $status login shows review status without storing a session',
        () async {
          final code = 'REGISTRATION_$status';
          final api = ApiClient(
            client: MockClient((request) async {
              expect(request.url.path, '/api/v1/auth/login');
              expect(request.headers.containsKey('Authorization'), false);
              expect(
                jsonDecode(request.body)['username'],
                'applicant@example.invalid',
              );
              return http.Response(
                jsonEncode({
                  'error': {
                    'code': code,
                    'message': status == 'PENDING'
                        ? 'Waiting for administrator approval.'
                        : 'Registration was rejected.',
                  },
                }),
                403,
              );
            }),
          );
          final store = MemoryTokenStore();
          final session = BackendSession(api: api, store: store);
          try {
            await expectLater(
              session.login(
                'applicant@example.invalid',
                'Synthetic-password-123',
                role,
              ),
              throwsA(
                isA<ApiFailure>()
                    .having((e) => e.code, 'code', code)
                    .having((e) => e.status, 'status', 403),
              ),
            );
            expect(session.signedIn, false);
            expect(store.token, isNull);
            expect(api.token, isNull);
          } finally {
            api.close();
            session.dispose();
          }
        },
      );
    }
  }
  for (final code in ['REGISTRATION_UNAVAILABLE', 'REGISTRATION_CONFLICT']) {
    test('registration preserves $code for recovery UI', () async {
      final api = ApiClient(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'error': {'code': code},
            }),
            code == 'REGISTRATION_CONFLICT' ? 409 : 503,
          ),
        ),
      );
      try {
        await expectLater(
          api.request(
            '/api/v1/registration',
            method: 'POST',
            authenticated: false,
          ),
          throwsA(isA<ApiFailure>().having((e) => e.code, 'code', code)),
        );
      } finally {
        api.close();
      }
    });
  }
}
