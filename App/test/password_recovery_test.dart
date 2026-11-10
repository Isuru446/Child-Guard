import 'support/backend_fixture.dart';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/login_screen.dart';
import 'package:final_project/screens/auth/forgot_password_screen.dart';

void main() {
  for (final role in [UserRole.parent, UserRole.teacher]) {
    testWidgets('$role opens the matching recovery screen and returns', (
      tester,
    ) async {
      useBackend(tester, signedIn: false);
      await tester.pumpWidget(
        MaterialApp(home: LoginScreen(selectedRole: role)),
      );
      final forgot = find.text('Forgot Password?');
      await tester.ensureVisible(forgot);
      await tester.tap(forgot);
      await tester.pumpAndSettle();
      final screen = tester.widget<ForgotPasswordScreen>(
        find.byType(ForgotPasswordScreen),
      );
      expect(screen.selectedRole, role);
      expect(screen.initialEmail, '');
      final back = find.text(
        role == UserRole.teacher
            ? 'Back to Teacher login'
            : 'Back to Parent login',
      );
      await tester.ensureVisible(back);
      await tester.tap(back);
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
    });

    testWidgets('$role Google sign-in button explains unavailable provider', (
      tester,
    ) async {
      useBackend(tester, signedIn: false);
      await tester.pumpWidget(
        MaterialApp(home: LoginScreen(selectedRole: role)),
      );

      final googleButton = find.widgetWithText(
        OutlinedButton,
        'Continue with Google',
      );
      await tester.ensureVisible(googleButton);
      await tester.tap(googleButton);
      await tester.pumpAndSettle();

      expect(find.text('Google sign-in is not configured.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  for (final role in [UserRole.parent, UserRole.teacher]) {
    testWidgets('$role recovery uses the blue branded header on mobile', (
      tester,
    ) async {
      useBackend(tester, signedIn: false);
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(home: ForgotPasswordScreen(selectedRole: role)),
      );

      expect(find.text('ChildGuard'), findsOneWidget);
      expect(
        find.text(
          role == UserRole.teacher
              ? 'Teacher account recovery'
              : 'Parent account recovery',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('Recovery validates email and explains unavailable delivery', (
    tester,
  ) async {
    useBackend(tester, signedIn: false);
    await tester.pumpWidget(
      const MaterialApp(
        home: ForgotPasswordScreen(selectedRole: UserRole.parent),
      ),
    );
    final button = find.text('Request reset link');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pump();
    expect(find.text('Please enter your email address'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'invalid');
    await tester.tap(button);
    await tester.pump();
    expect(find.text('Enter a valid email address'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'parent@example.com');
    await tester.tap(button);
    await tester.pump();
    expect(find.textContaining('No reset email has been sent'), findsOneWidget);
  });
}
