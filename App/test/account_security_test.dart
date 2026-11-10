import 'support/backend_fixture.dart';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/demo_security_store.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/login_screen.dart';
import 'package:final_project/screens/auth/role_selection_screen.dart';
import 'package:final_project/screens/main_wrapper.dart';
import 'package:final_project/screens/profile/account_security_screens.dart';
import 'package:final_project/screens/profile/privacy_safety_screen.dart';

void main() {
  setUp(() {
    DemoSecurityStore.setTwoStepEnabled(UserRole.parent, false);
    DemoSecurityStore.setLoginAlertsEnabled(UserRole.parent, false);
    DemoSecurityStore.endAllSessions();
  });

  testWidgets('login uses backend credentials without a demo OTP bypass', (
    tester,
  ) async {
    final fixture = useBackend(tester, signedIn: false);
    DemoSecurityStore.setTwoStepEnabled(UserRole.parent, true);
    await tester.pumpWidget(
      const MaterialApp(home: LoginScreen(selectedRole: UserRole.parent)),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'fixture-parent');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'fixture-password',
    );
    await tapVisible(tester, find.text('Login'));
    expect(find.byType(MainWrapperScreen), findsOneWidget);
    expect(find.byKey(const ValueKey('demoOtpCode')), findsNothing);
    expect(fixture.session.signedIn, isTrue);
    expect(fixture.store.token, 'fixture-token');
    expect(
      fixture.requests.where((r) => r.url.path == '/api/v1/auth/login'),
      hasLength(1),
    );
  });

  testWidgets('login alerts show the latest local sign-in', (tester) async {
    useBackend(tester, signedIn: false);
    DemoSecurityStore.setLoginAlertsEnabled(UserRole.parent, true);
    DemoSecurityStore.recordLogin(UserRole.parent);
    expect(DemoSecurityStore.lastLoginAlertFor(UserRole.parent), isNotNull);

    await tester.pumpWidget(
      const MaterialApp(home: PrivacySafetyScreen(userRole: UserRole.parent)),
    );

    expect(find.textContaining('Last local sign-in:'), findsOneWidget);
    expect(find.textContaining('No push alerts are sent.'), findsOneWidget);
  });

  testWidgets('password change rejects an incorrect current password', (
    tester,
  ) async {
    useBackend(tester, signedIn: false);
    await tester.pumpWidget(
      const MaterialApp(home: PrivacySafetyScreen(userRole: UserRole.parent)),
    );

    final changePassword = find.text('Change Password');
    await tester.ensureVisible(changePassword);
    await tester.tap(changePassword);
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'wrong-password');
    await tester.enterText(fields.at(1), 'newpass123');
    await tester.enterText(fields.at(2), 'newpass123');
    await tester.tap(find.text('Update password'));
    await tester.pumpAndSettle();
    expect(find.text('Current password is incorrect.'), findsOneWidget);

    await tester.enterText(fields.at(0), 'password123');
    await tester.tap(find.text('Update password'));
    await tester.pumpAndSettle();
    expect(find.text('Change password'), findsNothing);
    expect(DemoSecurityStore.passwordFor(UserRole.parent), 'newpass123');
    expect(
      DemoSecurityStore.changePassword(
        UserRole.parent,
        currentPassword: 'newpass123',
        newPassword: 'password123',
      ),
      isTrue,
    );
  });

  testWidgets('authorized guardians can be added and removed', (tester) async {
    useBackend(tester, signedIn: false);
    await tester.pumpWidget(
      const MaterialApp(home: AuthorizedGuardiansScreen()),
    );

    await tester.tap(find.text('Add guardian'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'Nimal Perera');
    await tester.enterText(find.byType(TextField).at(1), 'Uncle');
    await tester.tap(find.text('Add').last);
    await tester.pumpAndSettle();

    expect(find.text('Nimal Perera'), findsOneWidget);
    expect(
      DemoSecurityStore.guardians.any(
        (guardian) =>
            guardian.name == 'Nimal Perera' && guardian.relationship == 'Uncle',
      ),
      isTrue,
    );
    await tester.tap(find.byTooltip('Remove Nimal Perera'));
    await tester.pumpAndSettle();
    expect(find.text('Nimal Perera'), findsNothing);
  });

  testWidgets('ending the current session signs out to role selection', (
    tester,
  ) async {
    useBackend(tester, signedIn: false);
    DemoSecurityStore.recordLogin(UserRole.parent);
    await tester.pumpWidget(
      const MaterialApp(home: ActiveSessionsScreen(userRole: UserRole.parent)),
    );

    expect(find.text('Android device'), findsOneWidget);
    expect(
      DemoSecurityStore.sessionsFor(UserRole.parent).single.isCurrent,
      isTrue,
    );
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await tester.pumpAndSettle();

    expect(find.byType(RoleSelectionScreen), findsOneWidget);
    expect(DemoSecurityStore.sessionsFor(UserRole.parent), isEmpty);
  });

  test('demo sessions are separated by account role', () {
    DemoSecurityStore.recordLogin(UserRole.parent);
    DemoSecurityStore.recordLogin(UserRole.teacher);

    expect(DemoSecurityStore.sessionsFor(UserRole.parent), hasLength(1));
    expect(DemoSecurityStore.sessionsFor(UserRole.teacher), hasLength(1));
    expect(
      DemoSecurityStore.sessionsFor(UserRole.parent).single.isCurrent,
      isTrue,
    );
    expect(
      DemoSecurityStore.sessionsFor(UserRole.teacher).single.isCurrent,
      isTrue,
    );
  });
}
