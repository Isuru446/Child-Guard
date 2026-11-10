import 'support/backend_fixture.dart';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/app_language_controller.dart';
import 'package:final_project/core/app_theme_controller.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/alerts/alerts_screen.dart';
import 'package:final_project/screens/main_wrapper.dart';
import 'package:final_project/screens/profile/emergency_contacts_screen.dart';
import 'package:final_project/screens/profile/help_support_screen.dart';
import 'package:final_project/screens/map/map_screen.dart';
import 'package:final_project/screens/profile/profile_screen.dart';
import 'package:final_project/screens/profile/privacy_safety_screen.dart';
import 'package:final_project/screens/profile/settings_screen.dart';
import 'package:final_project/screens/profile/teacher_profile_screen.dart';
import 'package:final_project/screens/teacher/student_profile_screen.dart';

void main() {
  testWidgets('settings changes the app language between Sinhala and Tamil', (
    tester,
  ) async {
    useBackend(tester, signedIn: true);
    AppLanguageController.setLanguage('en');
    addTearDown(() => AppLanguageController.setLanguage('en'));

    await tester.pumpWidget(
      ValueListenableBuilder<Locale>(
        valueListenable: AppLanguageController.locale,
        builder: (context, locale, _) => MaterialApp(
          locale: locale,
          supportedLocales: const [Locale('en'), Locale('si'), Locale('ta')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const ProfileScreen(userRole: UserRole.parent),
        ),
      ),
    );

    Finder renderedText(String value) => find.byWidgetPredicate(
      (widget) => widget is RichText && widget.text.toPlainText() == value,
    );

    await tester.ensureVisible(find.text('App Settings'));
    await tester.tap(find.text('App Settings'));
    await tester.pumpAndSettle();
    final languageButton = find.byType(DropdownButton<String>);
    await tester.ensureVisible(languageButton);
    await tester.tap(languageButton);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sinhala').last);
    await tester.pumpAndSettle();

    expect(renderedText('සැකසීම්'), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byType(SettingsScreen),
        matching: find.widgetWithIcon(IconButton, Icons.arrow_back_rounded),
      ),
    );
    await tester.pumpAndSettle();
    expect(renderedText('පැතිකඩ'), findsOneWidget);

    await tester.ensureVisible(find.text('App Settings'));
    await tester.tap(find.text('App Settings'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(languageButton);
    await tester.tap(languageButton);
    await tester.pumpAndSettle();
    await tester.tap(renderedText('දෙමළ').last);
    await tester.pumpAndSettle();

    expect(renderedText('அமைப்புகள்'), findsOneWidget);

    await tester.tap(
      find.descendant(
        of: find.byType(SettingsScreen),
        matching: find.widgetWithIcon(IconButton, Icons.arrow_back_rounded),
      ),
    );
    await tester.pumpAndSettle();
    await tester.pumpWidget(
      ValueListenableBuilder<Locale>(
        valueListenable: AppLanguageController.locale,
        builder: (context, locale, _) => MaterialApp(
          locale: locale,
          supportedLocales: const [Locale('en'), Locale('si'), Locale('ta')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const MainWrapperScreen(userRole: UserRole.parent),
        ),
      ),
    );

    expect(renderedText('நேரடி இருப்பிடம்'), findsOneWidget);
    expect(find.text('முகப்பு'), findsOneWidget);
  });

  for (final size in [const Size(390, 844), const Size(1024, 768)]) {
    testWidgets('main navigation switches tabs at $size', (tester) async {
      useBackend(tester, signedIn: true);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        const MaterialApp(home: MainWrapperScreen(userRole: UserRole.parent)),
      );

      expect(find.byType(MainWrapperScreen), findsOneWidget);
      expect(
        find.byType(size.width >= 800 ? NavigationRail : BottomNavigationBar),
        findsOneWidget,
      );

      await tester.tap(find.text('Map').last);
      await tester.pumpAndSettle();
      expect(find.byType(MapScreen), findsOneWidget);

      await tester.tap(find.text('Alerts').last);
      await tester.pumpAndSettle();
      expect(find.byType(AlertsScreen), findsOneWidget);

      await tester.tap(find.text('Profile').last);
      await tester.pumpAndSettle();
      expect(find.byType(ProfileScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('map settings opens profile and settings page', (tester) async {
    useBackend(tester, signedIn: true);
    await tester.pumpWidget(const MaterialApp(home: MapScreen()));

    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    expect(find.byType(ProfileScreen), findsOneWidget);

    await tester.tap(find.byTooltip('App settings'));
    await tester.pumpAndSettle();
    expect(find.byType(SettingsScreen), findsOneWidget);
    expect(find.text('Parent preferences'), findsOneWidget);
    expect(find.text('Attendance alerts'), findsOneWidget);
    await tester.tap(find.byType(SwitchListTile).first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  for (final role in [UserRole.parent, UserRole.teacher]) {
    testWidgets('$role can open role-specific privacy and safety guidance', (
      tester,
    ) async {
      useBackend(tester, role: role == UserRole.teacher ? 'TEACHER' : 'PARENT');
      await tester.pumpWidget(MaterialApp(home: ProfileScreen(userRole: role)));
      await tester.ensureVisible(find.text('App Settings'));
      await tester.tap(find.text('App Settings'));
      await tester.pumpAndSettle();

      final privacyTile = find.widgetWithText(ListTile, 'Privacy & safety');
      await tester.ensureVisible(privacyTile);
      await tester.tap(privacyTile);
      await tester.pumpAndSettle();

      expect(find.byType(PrivacySafetyScreen), findsOneWidget);
      expect(find.text('Privacy & safety'), findsOneWidget);
      expect(find.textContaining('Only authorized Guardian children'), findsOneWidget);
      expect(find.text('Two-Step Verification'), findsNothing);
      expect(find.text('Login Alerts'), findsNothing);
      expect(tester.takeException(), isNull);

      await tester.pageBack();
      await tester.pumpAndSettle();
      final helpTile = find.widgetWithText(ListTile, 'Help & Support');
      await tester.ensureVisible(helpTile);
      await tester.tap(helpTile);
      await tester.pumpAndSettle();

      expect(find.byType(HelpSupportScreen), findsOneWidget);
      expect(find.textContaining('Contact your daycare'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'parent opens authorized child details without unsupported editing',
    (tester) async {
      useBackend(tester);
      await tester.pumpWidget(
        const MaterialApp(home: ProfileScreen(userRole: UserRole.parent)),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('My Child'));
      expect(find.byType(StudentProfileScreen), findsOneWidget);
      expect(find.text('Fixture Child'), findsOneWidget);
      expect(find.text('FIXTURE-WEARABLE \u00b7 OFFLINE'), findsOneWidget);
      expect(find.byTooltip('Edit child details'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('teacher profile loads and persists permitted account fields', (
    tester,
  ) async {
    final fixture = useBackend(tester, role: 'TEACHER');
    await tester.pumpWidget(
      const MaterialApp(home: ProfileScreen(userRole: UserRole.teacher)),
    );
    await tester.pumpAndSettle();
    expect(find.text('fixture-teacher'), findsOneWidget);
    expect(find.text('Fixture daycare'), findsOneWidget);
    await tapVisible(tester, find.text('My Profile'));
    expect(find.byType(TeacherProfileScreen), findsOneWidget);
    expect(find.text('Save profile'), findsOneWidget);
    await tester.enterText(
      find.byType(TextFormField).first,
      'Updated Fixture Teacher',
    );
    await tapVisible(tester, find.text('Save profile'));
    expect(fixture.accountProfile['fullName'], 'Updated Fixture Teacher');
    expect(
      fixture.requests.where(
        (r) => r.url.path == '/api/v1/mobile/profile' && r.method == 'PATCH',
      ),
      hasLength(1),
    );
    expect(fixture.session.user?['role'], 'TEACHER');
  });

  for (final role in [UserRole.parent, UserRole.teacher]) {
    testWidgets('$role settings and help pages show role-specific content', (
      tester,
    ) async {
      useBackend(tester, role: role == UserRole.teacher ? 'TEACHER' : 'PARENT');
      await tester.pumpWidget(MaterialApp(home: ProfileScreen(userRole: role)));
      final isTeacher = role == UserRole.teacher;

      expect(find.text('Notification Settings'), findsNothing);
      await tester.ensureVisible(find.text('App Settings'));
      await tester.tap(find.text('App Settings'));
      await tester.pumpAndSettle();
      expect(find.byType(SettingsScreen), findsOneWidget);
      expect(
        find.text(isTeacher ? 'Teacher preferences' : 'Parent preferences'),
        findsOneWidget,
      );
      expect(
        find.text(isTeacher ? 'Attendance updates' : 'Attendance alerts'),
        findsOneWidget,
      );

      final darkModeTile = find.widgetWithText(SwitchListTile, 'Dark mode');
      await tester.ensureVisible(darkModeTile);
      await tester.tap(darkModeTile);
      await tester.pumpAndSettle();
      expect(AppThemeController.themeMode.value, ThemeMode.dark);
      await tester.tap(darkModeTile);
      await tester.pumpAndSettle();
      expect(AppThemeController.themeMode.value, ThemeMode.light);

      await tester.pageBack();
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Help & Support'));
      await tester.tap(find.text('Help & Support'));
      await tester.pumpAndSettle();
      expect(find.byType(HelpSupportScreen), findsOneWidget);
      expect(find.textContaining('Contact your daycare'), findsOneWidget);
      expect(find.text('Call school office'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('$role emergency contacts loads persisted profile contacts', (
      tester,
    ) async {
      useBackend(tester, role: role == UserRole.teacher ? 'TEACHER' : 'PARENT');
      await tester.pumpWidget(MaterialApp(home: ProfileScreen(userRole: role)));
      await tester.ensureVisible(find.text('Emergency Contacts'));
      await tester.tap(find.text('Emergency Contacts'));
      await tester.pumpAndSettle();

      expect(find.byType(EmergencyContactsScreen), findsOneWidget);
      expect(find.text('Trusted contacts'), findsOneWidget);
      expect(find.text('Add contact'), findsOneWidget);
      expect(find.text('Demo Guardian'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
