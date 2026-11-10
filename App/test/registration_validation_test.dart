import 'dart:convert';

import 'package:final_project/core/backend.dart';
import 'package:final_project/core/registration.dart';
import 'package:final_project/core/registration_validation.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/register_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/backend_fixture.dart';

void main() {
  for (final (field, invalid, valid) in [
    ('fullName', 'P', 'Fixture Parent'),
    ('username', 'Parent Name', 'parent.name'),
    ('email', 'parent@example', 'parent@example.invalid'),
    ('phone', 'call me', '+94 (70) 123-4567'),
    ('centerCode', 'my-center', List.filled(64, 'b').join()),
    ('claimCode', '1234', List.filled(64, 'c').join()),
    ('existingChildId', 'child-1', BackendFixture.childId),
    ('dateOfBirth', '2021-02-31', '2020-02-29'),
    ('dateOfBirth', '2999-01-01', '2021-01-01'),
    ('dateOfBirth', '01/02/2021', '2021-02-01'),
    ('relationship', 'P', 'Guardian'),
    ('hardwareId', List.filled(101, 'x').join(), 'SYNTHETIC'),
  ]) {
    test('$field rejects invalid format and accepts valid format', () {
      expect(RegistrationValidation.field(field, invalid), isNotNull);
      expect(RegistrationValidation.field(field, valid), isNull);
      expect(RegistrationValidation.field(field, ''), 'Required');
    });
  }

  for (final (role, rejected) in [
    (UserRole.teacher, false),
    (UserRole.parent, false),
    (UserRole.parent, true),
  ]) {
    testWidgets(
      '$role existing-child/Teacher payload and field errors: $rejected',
      (tester) async {
        final fixture = useBackend(tester, signedIn: false);
        var calls = 0;
        final api = ApiClient(
          client: MockClient((request) async {
            if (request.url.path == '/api/v1/registration/centers') {
              return BackendFixture.centersResponse();
            }
            calls++;
            final body = jsonDecode(request.body) as Map;
            expect(
              body['role'],
              role == UserRole.teacher ? 'TEACHER' : 'PARENT',
            );
            expect(body['centerId'], BackendFixture.centerId);
            expect(body.containsKey('centerCode'), false);
            expect(body['acceptTerms'], true);
            expect(
              body['children'],
              role == UserRole.teacher
                  ? []
                  : [
                      {
                        'existingChildId': BackendFixture.childId,
                        'relationship': 'Guardian',
                      },
                    ],
            );
            expect(request.headers.containsKey('Authorization'), false);
            return http.Response(
              jsonEncode(
                rejected
                    ? {
                        'error': {
                          'code': 'VALIDATION_ERROR',
                          'message':
                              'Check the highlighted registration fields.',
                          'fields': {'username': 'Use another valid username'},
                        },
                      }
                    : {
                        'data': {'status': 'PENDING', 'children': []},
                      },
              ),
              rejected ? 422 : 201,
            );
          }),
        );
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            home: RegisterScreen(
              selectedRole: role,
              registrationClient: RegistrationClient(
                api: api,
                store: MemoryTokenStore(),
              ),
            ),
          ),
        );
        if (role == UserRole.parent) {
          await tapVisible(
            tester,
            find.widgetWithText(
              SwitchListTile,
              'Child already registered at this center',
            ),
          );
        }
        await selectRegistrationCenter(tester);
        final fields = find.byType(TextFormField);
        final values = [
          'Fixture Parent',
          'fixture-parent',
          'fixture@example.invalid',
          '0700000000',
          if (role == UserRole.parent) ...[BackendFixture.childId, 'Guardian'],
          'fixture-password',
          'fixture-password',
        ];
        expect(fields, findsNWidgets(values.length));
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
        expect(calls, 1);
        if (rejected) {
          expect(find.text('Use another valid username'), findsOneWidget);
          expect(
            tester.widget<TextFormField>(fields.at(1)).controller!.text,
            'fixture-parent',
          );
          expect(
            find.text(
              'Your registration has been submitted and is awaiting administrator approval.',
            ),
            findsNothing,
          );
        } else {
          expect(
            find.text(
              'Your registration has been submitted and is awaiting administrator approval.',
            ),
            findsOneWidget,
          );
        }
        expect(fixture.session.signedIn, false);
        expect(fixture.session.api.token, isNull);
        expect(fixture.store.token, isNull);
      },
    );
  }
}
