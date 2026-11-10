import 'dart:async';

import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/auth/login_screen.dart';
import 'package:final_project/screens/auth/role_selection_screen.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/main_wrapper.dart';
import 'package:final_project/screens/profile/profile_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'support/backend_fixture.dart';

void main() {
  testWidgets('network login failure is recoverable and never signs in', (
    tester,
  ) async {
    final fixture = useBackend(tester, signedIn: false);
    fixture.respond = (_) => throw http.ClientException('fixture offline');
    await tester.pumpWidget(
      const MaterialApp(home: LoginScreen(selectedRole: UserRole.parent)),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'fixture-parent');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'fixture-password',
    );
    await tapVisible(tester, find.text('Login'));
    expect(
      find.text('Cannot reach ChildGuard. Check your connection.'),
      findsOneWidget,
    );
    expect(fixture.session.signedIn, isFalse);
    expect(fixture.requests.where((r) => r.method == 'POST'), hasLength(1));
  });

  testWidgets('empty attendance alerts and missing wearable stay honest', (
    tester,
  ) async {
    final fixture = useBackend(tester);
    fixture.respond = (request) {
      if (request.url.path.endsWith('/attendance') ||
          request.url.path.endsWith('/alerts')) {
        return BackendFixture.data(<dynamic>[]);
      }
      if (request.url.path.endsWith('/device')) {
        return BackendFixture.data(null);
      }
      return null;
    };
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: SingleChildScrollView(child: ChildPanel())),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('No attendance records for this selection.'),
      findsOneWidget,
    );
    expect(find.text('No registered wearable'), findsOneWidget);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ChildPanel(section: 'alerts')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No recorded alerts.'), findsOneWidget);
  });
  testWidgets('feed transitions from loading to success without network IO', (
    tester,
  ) async {
    useBackend(tester);
    final pending = Completer<String>();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BackendFeed(
            load: () => pending.future,
            builder: (_, value) => Text(value as String),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    pending.complete('Fixture loaded');
    await tester.pumpAndSettle();
    expect(find.text('Fixture loaded'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsNothing);
  });

  testWidgets('empty roster shows honest empty state', (tester) async {
    final fixture = useBackend(tester)..children.clear();
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ChildPanel())),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('No children are linked to your account yet.'),
      findsOneWidget,
    );
    expect(
      fixture.requests.any((r) => r.url.path.contains('/children/')),
      isFalse,
    );
  });

  testWidgets('server failure is shown and refresh recovers', (tester) async {
    final fixture = useBackend(tester);
    fixture.respond = (_) => BackendFixture.error(503, 'Fixture maintenance');
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ChildPanel())),
    );
    await tester.pumpAndSettle();
    expect(find.text('Fixture maintenance'), findsOneWidget);
    fixture.respond = null;
    await tapVisible(tester, find.byTooltip('Refresh'));
    expect(find.text('Fixture Child'), findsOneWidget);
    expect(find.text('Fixture maintenance'), findsNothing);
    expect(find.text('Not enough data yet'), findsOneWidget);
    await tapVisible(tester, find.text('More details'));
    expect(find.textContaining('Latest movement: Unavailable'), findsOneWidget);
    expect(find.text('FIXTURE-WEARABLE · OFFLINE'), findsOneWidget);
  });

  testWidgets(
    '401 clears session and returns authenticated navigation to role selection',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.respond = (_) => BackendFixture.error(401, 'Session expired');
      await tester.pumpWidget(
        const MaterialApp(home: MainWrapperScreen(userRole: UserRole.parent)),
      );
      await tester.pumpAndSettle();
      expect(fixture.session.signedIn, isFalse);
      expect(fixture.store.token, isNull);
      expect(find.byType(RoleSelectionScreen), findsOneWidget);
      expect(find.byType(MainWrapperScreen), findsNothing);
    },
  );

  testWidgets(
    'specific unavailable child never falls back to another authorized child',
    (tester) async {
      final fixture = useBackend(tester);
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ChildPanel(childId: 'not-in-roster')),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('This child is no longer available to this account.'),
        findsOneWidget,
      );
      expect(find.text('Fixture Child'), findsNothing);
      expect(
        fixture.requests.any((r) => r.url.path.contains('/children/')),
        isFalse,
      );
    },
  );

  testWidgets(
    'teacher confirmation uses existing endpoint and epoch only in mocked HTTP',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: PendingAttendancePanel()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Confirm'));
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Confirm').last,
      );
      final posts = fixture.requests.where((r) => r.method == 'POST').toList();
      expect(posts, hasLength(1));
      expect(
        posts.single.url.path,
        '/api/v1/attendance/fixture-attendance/confirm',
      );
      expect(posts.single.body, '{"attendanceEpoch":"fixture-epoch"}');
      expect(fixture.attendance['status'], 'PRESENT');
      expect(find.text('Attendance confirmed by the backend.'), findsOneWidget);
    },
  );

  testWidgets(
    'standalone pushed alerts load even when the Home tab is selected',
    (tester) async {
      final fixture = useBackend(tester);
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('Alerts'));
      expect(find.text('Danger-zone alert'), findsOneWidget);
      expect(
        fixture.requests.any((r) => r.url.path.endsWith('/alerts')),
        isTrue,
      );
    },
  );

  for (final role in [UserRole.parent, UserRole.teacher]) {
    testWidgets('$role logs in with mocked HTTP and logs out securely', (
      tester,
    ) async {
      final fixture = useBackend(
        tester,
        role: role == UserRole.teacher ? 'TEACHER' : 'PARENT',
        signedIn: false,
      );
      await tester.pumpWidget(
        MaterialApp(home: LoginScreen(selectedRole: role)),
      );
      await tester.enterText(
        find.byType(TextFormField).at(0),
        fixture.profile['username'] as String,
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'fixture-password',
      );
      await tapVisible(tester, find.text('Login'));
      expect(find.byType(MainWrapperScreen), findsOneWidget);
      await tapVisible(tester, find.text('Profile').last);
      expect(find.byType(ProfileScreen), findsOneWidget);
      await tapVisible(tester, find.text('Logout'));
      expect(find.byType(RoleSelectionScreen), findsOneWidget);
      expect(fixture.session.api.token, isNull);
      expect(fixture.store.token, isNull);
    });
  }

  testWidgets(
    'invalid login and wrong selected role never enter authenticated screens',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER', signedIn: false);
      for (final selectedRole in [UserRole.parent, UserRole.teacher]) {
        final accountRole = selectedRole == UserRole.parent
            ? 'TEACHER'
            : 'PARENT';
        fixture.profile['role'] = accountRole;
        fixture.profile['username'] = 'fixture-${accountRole.toLowerCase()}';
        await tester.pumpWidget(
          MaterialApp(
            key: ValueKey(selectedRole),
            home: LoginScreen(selectedRole: selectedRole),
          ),
        );
        await tester.enterText(
          find.byType(TextFormField).at(0),
          fixture.profile['username'] as String,
        );
        await tester.enterText(find.byType(TextFormField).at(1), 'wrong');
        await tapVisible(tester, find.text('Login'));
        expect(find.text('Invalid credentials'), findsOneWidget);
        expect(fixture.session.signedIn, isFalse);
        expect(fixture.session.user, isNull);
        expect(fixture.session.api.token, isNull);
        expect(fixture.store.token, isNull);
        expect(find.byType(MainWrapperScreen), findsNothing);

        // SnackBars queue. Dismiss the first error before checking the result
        // of the next request; pumpAndSettle does not expire its display timer.
        tester
            .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
            .removeCurrentSnackBar();
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byType(TextFormField).at(1),
          'fixture-password',
        );
        await tapVisible(tester, find.text('Login'));
        expect(
          find.text('This account does not match the selected role.'),
          findsOneWidget,
        );
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(find.byType(MainWrapperScreen), findsNothing);
        expect(fixture.session.signedIn, isFalse);
        expect(fixture.session.user, isNull);
        expect(fixture.session.api.token, isNull);
        expect(fixture.store.token, isNull);
      }
      expect(
        fixture.requests.where((r) => r.url.path == '/api/v1/auth/login'),
        hasLength(4),
      );
    },
  );

  for (final size in [
    const Size(320, 568),
    const Size(390, 844),
    const Size(1024, 768),
  ]) {
    testWidgets('authenticated dashboard has no layout errors at $size', (
      tester,
    ) async {
      useBackend(tester);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Fixture Child'), findsWidgets);
      await tester.ensureVisible(find.text("Activity"));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  }
}
