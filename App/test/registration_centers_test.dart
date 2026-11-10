import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/register_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'support/backend_fixture.dart';

void main() {
  for (final mode in ['empty', 'network']) {
    testWidgets('registration center list handles $mode and Retry', (
      tester,
    ) async {
      final fixture = useBackend(tester, signedIn: false);
      fixture.respond = (request) {
        expect(request.url.path, '/api/v1/registration/centers');
        expect(request.headers.containsKey('Authorization'), isFalse);
        if (mode == 'network') {
          throw http.ClientException('Synthetic offline backend');
        }
        return BackendFixture.data([]);
      };
      await tester.pumpWidget(
        const MaterialApp(home: RegisterScreen(selectedRole: UserRole.parent)),
      );
      await tester.pumpAndSettle();
      if (mode == 'empty') {
        expect(
          find.text(
            'No centers are currently accepting public registrations. Contact your center.',
          ),
          findsOneWidget,
        );
      } else {
        expect(find.textContaining('Unable to load centers.'), findsOneWidget);
        expect(find.text('Retry'), findsOneWidget);
      }
      fixture.respond = (_) => BackendFixture.centersResponse();
      await tapVisible(
        tester,
        find.text(mode == 'empty' ? 'Refresh centers' : 'Retry'),
      );
      await selectRegistrationCenter(tester);
      expect(find.text(BackendFixture.centerName), findsOneWidget);
      expect(
        fixture.requests.every((request) => request.method == 'GET'),
        true,
      );
      expect(fixture.session.signedIn, false);
    });
  }

  testWidgets(
    'selection survives edits and resets when a center is withdrawn',
    (tester) async {
      final fixture = useBackend(tester, signedIn: false);
      await tester.pumpWidget(
        const MaterialApp(home: RegisterScreen(selectedRole: UserRole.teacher)),
      );
      await selectRegistrationCenter(tester);
      final firstField = find.byType(TextFormField).first;
      await tester.ensureVisible(firstField);
      await tester.enterText(firstField, 'Synthetic Teacher');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      final dropdown = find.byType(DropdownButtonFormField<String>);
      expect(
        tester.state<FormFieldState<String>>(dropdown).value,
        BackendFixture.centerId,
      );
      fixture.respond = (_) => BackendFixture.data([]);
      await tapVisible(tester, find.text('Refresh centers'));
      expect(tester.state<FormFieldState<String>>(dropdown).value, isNull);
      expect(
        tester.widget<TextFormField>(firstField).controller!.text,
        'Synthetic Teacher',
      );
      expect(
        fixture.requests.every((request) => request.method == 'GET'),
        true,
      );
    },
  );
}
