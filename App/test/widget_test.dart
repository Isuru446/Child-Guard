import 'support/backend_fixture.dart';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/main.dart';
import 'package:final_project/screens/auth/login_screen.dart';

void main() {
  for (final size in [
    const Size(320, 568),
    const Size(390, 844),
    const Size(1024, 768),
  ]) {
    testWidgets('Welcome and login adapt to $size', (tester) async {
      useBackend(tester, signedIn: false);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const ChildGuardApp());
      await tester.pump(const Duration(milliseconds: 1300));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final parent = find.text("I'm a Parent");
      await tester.ensureVisible(parent);
      await tester.tap(parent);
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
