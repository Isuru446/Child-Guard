import 'dart:convert';

import 'package:final_project/core/backend.dart';
import 'package:final_project/core/registration.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/register_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/backend_fixture.dart';

class LegacyReceiptStore extends RegistrationReceiptStore {
  String? saved;
  LegacyReceiptStore() : super(role: 'TEACHER');
  @override
  Future<String?> read() async => saved;
  @override
  Future<String?> readLegacy() async => List.filled(64, 'a').join();
  @override
  Future<void> write(String value) async {
    saved = value;
  }
}

void main() {
  for (final status in ['PENDING', 'REJECTED', 'APPROVED']) {
    testWidgets(
      'receipt conflict opens $status recovery without another submission',
      (tester) async {
        final fixture = useBackend(tester, signedIn: false);
        var posts = 0;
        final api = ApiClient(
          client: MockClient((request) async {
            if (request.url.path.endsWith('/centers')) {
              return BackendFixture.centersResponse();
            }
            if (request.method == 'POST') {
              posts++;
              return http.Response(
                jsonEncode({
                  'error': {
                    'code': 'RECEIPT_REUSED',
                    'message': 'Use the status or resubmission workflow',
                  },
                }),
                409,
              );
            }
            return BackendFixture.data({
              'status': status,
              'role': 'TEACHER',
              'username': 'fixture-teacher',
              'fullName': 'Fixture Teacher',
              'email': 'fixture@example.invalid',
              'phone': '0700000000',
              'centerId': BackendFixture.centerId,
              'children': [],
            });
          }),
        );
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            home: RegisterScreen(
              selectedRole: UserRole.teacher,
              registrationClient: RegistrationClient(
                api: api,
                store: MemoryTokenStore(),
              ),
            ),
          ),
        );
        await selectRegistrationCenter(tester);
        final fields = find.byType(TextFormField);
        final values = [
          'Fixture Teacher',
          'fixture-teacher',
          'fixture@example.invalid',
          '0700000000',
          'fixture-password',
          'fixture-password',
        ];
        for (var i = 0; i < values.length; i++) {
          await tester.ensureVisible(fields.at(i));
          await tester.enterText(fields.at(i), values[i]);
        }
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        await tapVisible(tester, find.byType(CheckboxListTile));
        await tapVisible(
          tester,
          find.widgetWithText(ElevatedButton, 'Sign Up'),
        );
        expect(posts, 1);
        expect(
          find.text('Application: fixture-teacher (TEACHER)'),
          findsOneWidget,
        );
        expect(
          find.text('Use the status or resubmission workflow'),
          findsNothing,
        );
        expect(fixture.session.signedIn, false);
        expect(fixture.store.token, isNull);
      },
    );
  }
  test('receipt storage is separate for Parent and Teacher without deleting legacy access', () {
    final parent = RegistrationReceiptStore(role: 'PARENT');
    final teacher = RegistrationReceiptStore(role: 'TEACHER');
    expect(parent.key, isNot(teacher.key));
    expect(parent.legacyKey, teacher.legacyKey);
  });
  for (final role in ['PARENT', 'TEACHER']) {
    test(
      'legacy receipt only migrates after matching verified $role identity',
      () async {
        final store = LegacyReceiptStore();
        final api = ApiClient(
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({
                'data': {'status': 'PENDING', 'role': role},
              }),
              200,
            ),
          ),
        );
        addTearDown(api.close);
        final client = RegistrationClient(
          api: api,
          store: store,
          role: 'TEACHER',
        );
        if (role == 'TEACHER') {
          expect((await client.status())['status'], 'PENDING');
          expect(store.saved, isNotNull);
        } else {
          await expectLater(client.status(), throwsA(isA<ApiFailure>()));
          expect(store.saved, isNull);
        }
      },
    );
  }
  for (final status in ['PENDING', 'APPROVED', 'REJECTED']) {
    testWidgets(
      'saved $status application restores truthful status without another POST',
      (tester) async {
        final fixture = useBackend(tester, signedIn: false);
        final requests = <http.Request>[];
        final store = MemoryTokenStore()..token = List.filled(64, 'c').join();
        final api = ApiClient(
          client: MockClient((request) async {
            requests.add(request);
            if (request.url.path.endsWith('/centers')) {
              return BackendFixture.centersResponse();
            }
            expect(request.method, 'GET');
            return BackendFixture.data({
              'status': status,
              'role': 'PARENT',
              'username': 'fixture-parent',
              'fullName': 'Fixture Parent',
              'email': 'fixture@example.invalid',
              'phone': '0700000000',
              'centerId': BackendFixture.centerId,
              'children': [
                {
                  'fullName': 'Restored child',
                  'dateOfBirth': '2021-01-01T00:00:00.000Z',
                  'relationship': 'Parent',
                },
              ],
            });
          }),
        );
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            home: RegisterScreen(
              selectedRole: UserRole.parent,
              registrationClient: RegistrationClient(api: api, store: store),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('Application: fixture-parent (PARENT)'),
          findsOneWidget,
        );
        expect(requests.every((request) => request.method == 'GET'), true);
        if (status == 'REJECTED') {
          await tapVisible(tester, find.text('Correct and resubmit'));
          expect(find.text('Restored child'), findsOneWidget);
          expect(find.text('2021-01-01'), findsOneWidget);
          final username = tester
              .widgetList<TextField>(find.byType(TextField))
              .firstWhere(
                (field) => field.controller?.text == 'fixture-parent',
              );
          expect(username.readOnly, true);
        }
        expect(fixture.session.signedIn, false);
        expect(fixture.store.token, isNull);
      },
    );
  }
}
