import 'dart:convert';

import 'package:final_project/core/backend.dart';
import 'package:final_project/core/registration.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/register_screen.dart';
import 'package:final_project/screens/auth/login_screen.dart';
import 'package:final_project/screens/auth/registration_child_form.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/backend_fixture.dart';

void main() {
  for (final role in [UserRole.parent, UserRole.teacher]) {
    for (final mode in ['enabled', 'disabled', 'network', 'unexpected']) {
      testWidgets('$role Login registration navigation: $mode', (tester) async {
        final fixture = useBackend(tester, signedIn: false);
        fixture.respond = (request) {
          if (request.url.path == '/api/v1/registration/centers') {
            return BackendFixture.centersResponse();
          }
          expect(request.url.path, '/api/v1/registration/availability');
          expect(request.headers.containsKey('Authorization'), isFalse);
          if (mode == 'network') {
            throw http.ClientException('Synthetic network failure');
          }
          return http.Response(
            jsonEncode({
              'data': {
                'enabled': mode == 'unexpected' ? 'true' : mode == 'enabled',
              },
            }),
            200,
          );
        };
        await tester.pumpWidget(
          MaterialApp(home: LoginScreen(selectedRole: role)),
        );
        await tapVisible(tester, find.text('Sign Up'));
        if (mode == 'enabled') {
          expect(find.byType(RegisterScreen), findsOneWidget);
          expect(
            find.text(
              'Create ${role == UserRole.teacher ? 'Teacher' : 'Parent'} Account',
            ),
            findsOneWidget,
          );
        } else {
          expect(find.byType(RegisterScreen), findsNothing);
          expect(
            find.text(
              mode == 'disabled'
                  ? 'Self-registration is currently disabled by your administrator.'
                  : mode == 'network'
                  ? 'Unable to check registration availability. Cannot reach ChildGuard. Check your connection.'
                  : 'Unable to check registration availability. Unexpected registration availability response.',
            ),
            findsOneWidget,
          );
          if (mode == 'network') {
            fixture.respond = (request) =>
                request.url.path == '/api/v1/registration/centers'
                ? BackendFixture.centersResponse()
                : http.Response(
                    jsonEncode({
                      'data': {'enabled': true},
                    }),
                    200,
                  );
            await tapVisible(tester, find.text('Retry'));
            expect(find.byType(RegisterScreen), findsOneWidget);
          }
        }
        expect(fixture.session.signedIn, isFalse);
        expect(fixture.store.token, isNull);
        expect(
          fixture.requests.every((request) => request.method == 'GET'),
          isTrue,
        );
      });
    }
  }

  for (final (success, multiple) in [
    (true, false),
    (false, false),
    (true, true),
  ]) {
    testWidgets(
      multiple
          ? 'registration preserves multiple children and child-specific wearable requests'
          : success
          ? 'registration persists pending application without authenticating'
          : 'registration backend rejection never claims success or grants a session',
      (tester) async {
        final fixture = useBackend(tester, signedIn: false);
        final calls = <http.Request>[];
        final receiptStore = MemoryTokenStore();
        final client = ApiClient(
          client: MockClient((request) async {
            if (request.url.path == '/api/v1/registration/centers') {
              return BackendFixture.centersResponse();
            }
            calls.add(request);
            expect(request.url.path, '/api/v1/registration');
            expect(
              request.headers['X-Registration-Receipt'],
              matches(RegExp(r'^[a-f0-9]{64}$')),
            );
            expect(request.headers.containsKey('Authorization'), isFalse);
            final sent = jsonDecode(request.body) as Map;
            expect(sent['role'], 'PARENT');
            expect(sent['centerId'], BackendFixture.centerId);
            expect(sent.containsKey('centerCode'), false);
            expect(sent['fullName'], 'Fixture Parent');
            expect(sent['username'], 'fixture-parent');
            expect(sent['email'], 'fixture@example.invalid');
            expect(sent['phone'], '0700000000');
            expect(sent['children'], [
              {
                'fullName': 'Synthetic child',
                'dateOfBirth': '2021-01-01',
                'relationship': 'Parent',
                if (multiple)
                  'wearable': {
                    'hardwareId': 'SYNTHETIC-WEARABLE',
                    'claimCode': List.filled(64, 'c').join(),
                  },
              },
              if (multiple)
                {
                  'fullName': 'Second synthetic child',
                  'dateOfBirth': '2022-02-02',
                  'relationship': 'Guardian',
                },
            ]);
            expect(sent['acceptTerms'], isTrue);
            return http.Response(
              jsonEncode(
                success
                    ? {
                        'data': {
                          'id': 'synthetic-application',
                          'status': 'PENDING',
                          'children': [],
                        },
                      }
                    : {
                        'error': {
                          'message': 'Registration details are unavailable',
                        },
                      },
              ),
              success ? 201 : 409,
            );
          }),
        );
        addTearDown(client.close);
        await tester.pumpWidget(
          MaterialApp(
            home: RegisterScreen(
              selectedRole: UserRole.parent,
              registrationClient: RegistrationClient(
                api: client,
                store: receiptStore,
              ),
            ),
          ),
        );
        await selectRegistrationCenter(tester);
        final fields = find.byType(TextFormField);
        final values = [
          'Fixture Parent',
          'fixture-parent',
          'fixture@example.invalid',
          '0700000000',
          'Synthetic child',
          '2021-01-01',
          'Parent',
          'fixture-password',
          'fixture-password',
        ];
        expect(fields, findsNWidgets(values.length));
        for (var index = 0; index < values.length; index++) {
          await tester.ensureVisible(fields.at(index));
          await tester.enterText(fields.at(index), values[index]);
        }
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        if (multiple) {
          await tapVisible(tester, find.text('Add another child'));
          final children = find.byType(RegistrationChildForm);
          expect(children, findsNWidgets(2));
          final secondFields = find.descendant(
            of: children.at(1),
            matching: find.byType(TextFormField),
          );
          final secondValues = [
            'Second synthetic child',
            '2022-02-02',
            'Guardian',
          ];
          for (var index = 0; index < secondValues.length; index++) {
            await tester.ensureVisible(secondFields.at(index));
            await tester.enterText(secondFields.at(index), secondValues[index]);
          }
          FocusManager.instance.primaryFocus?.unfocus();
          await tester.pumpAndSettle();
          await tapVisible(
            tester,
            find.descendant(
              of: children.at(0),
              matching: find.widgetWithText(
                SwitchListTile,
                'Add wearable request (optional)',
              ),
            ),
          );
          final firstFields = find.descendant(
            of: children.at(0),
            matching: find.byType(TextFormField),
          );
          await tester.ensureVisible(firstFields.at(3));
          await tester.enterText(firstFields.at(3), 'SYNTHETIC-WEARABLE');
          await tester.ensureVisible(firstFields.at(4));
          await tester.enterText(
            firstFields.at(4),
            List.filled(64, 'c').join(),
          );
          FocusManager.instance.primaryFocus?.unfocus();
          await tester.pumpAndSettle();
        }
        await tapVisible(tester, find.byType(CheckboxListTile));
        await tapVisible(
          tester,
          find.widgetWithText(ElevatedButton, 'Sign Up'),
        );
        expect(calls, hasLength(1));
        expect(
          find.text(
            success
                ? 'Your registration has been submitted and is awaiting administrator approval.'
                : 'Registration details are unavailable',
          ),
          findsOneWidget,
        );
        expect(
          find.text('Account created successfully! Please log in.'),
          findsNothing,
        );
        expect(fixture.session.signedIn, isFalse);
        expect(fixture.session.api.token, isNull);
        expect(fixture.store.token, isNull);
        expect(fixture.requests, isEmpty);
        expect(receiptStore.token, isNotNull);
      },
    );
  }
  testWidgets('invalid empty registration never submits HTTP', (tester) async {
    final fixture = useBackend(tester, signedIn: false);
    await tester.pumpWidget(
      MaterialApp(home: RegisterScreen(selectedRole: UserRole.teacher,registrationClient:RegistrationClient(api:fixture.session.api,store:MemoryTokenStore()))),
    );
    await tester.pumpAndSettle();
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Sign Up'));
    expect(find.text('Required'), findsWidgets);
    expect(
      fixture.requests.where((request) => request.method != 'GET'),
      isEmpty,
    );
    expect(fixture.session.signedIn, isFalse);
    expect(fixture.session.api.token, isNull);
    expect(fixture.store.token, isNull);
  });
  for (final role in ['PARENT', 'TEACHER']) {
    test(
      '$role restores through the real client contract and clears token on logout',
      () async {
        final store = MemoryTokenStore()..token = 'synthetic-restored-token';
        final paths = <String>[];
        final api = ApiClient(
          client: MockClient((request) async {
            paths.add(request.url.path);
            expect(
              request.headers['Authorization'],
              'Bearer synthetic-restored-token',
            );
            return http.Response(
              jsonEncode({
                'data': {
                  'id': 'synthetic-user',
                  'username': 'synthetic-account',
                  'role': role,
                  'centerId': 'synthetic-center',
                },
              }),
              200,
            );
          }),
        );
        final session = BackendSession(api: api, store: store);
        try {
          expect(await session.restore(), isTrue);
          expect(paths, ['/api/v1/auth/me']);
          expect(session.user?['role'], role);
          expect(session.teacher, role == 'TEACHER');
          await session.logout();
          expect(session.signedIn, isFalse);
          expect(api.token, isNull);
          expect(store.token, isNull);
        } finally {
          api.close();
          session.dispose();
        }
      },
    );
  }

  test(
    'inactive or expired server identity cannot restore a remembered session',
    () async {
      final store = MemoryTokenStore()..token = 'synthetic-rejected-token';
      final api = ApiClient(
        client: MockClient(
          (_) async => http.Response(
            '{"error":{"code":"UNAUTHENTICATED","message":"Sign in required"}}',
            401,
          ),
        ),
      );
      final session = BackendSession(api: api, store: store);
      try {
        expect(await session.restore(), isFalse);
        expect(session.user, isNull);
        expect(api.token, isNull);
        expect(store.token, isNull);
      } finally {
        api.close();
        session.dispose();
      }
    },
  );

  test(
    'successful responses need the backend data envelope but may contain null',
    () async {
      final missing = ApiClient(
        client: MockClient(
          (_) async => http.Response('{"unexpected":[]}', 200),
        ),
      );
      final absent = ApiClient(
        client: MockClient((_) async => http.Response('{"data":null}', 200)),
      );
      try {
        await expectLater(
          missing.request('/api/health', authenticated: false),
          throwsA(isA<ApiFailure>()),
        );
        expect(
          await absent.request('/api/health', authenticated: false),
          isNull,
        );
      } finally {
        missing.close();
        absent.close();
      }
    },
  );
}
