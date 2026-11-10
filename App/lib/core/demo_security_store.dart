import 'package:flutter/foundation.dart';

import '../models/user_role.dart';

class DemoSecurityStore {
  DemoSecurityStore._();

  static final Map<UserRole, _DemoAccountSecurity> _accounts = {
    UserRole.parent: _DemoAccountSecurity(),
    UserRole.teacher: _DemoAccountSecurity(),
    UserRole.admin: _DemoAccountSecurity(),
  };

  static final List<DemoGuardian> _guardians = [
    DemoGuardian(name: 'Grandma Rose', relationship: 'Grandmother'),
    DemoGuardian(name: 'Uncle James', relationship: 'Uncle'),
  ];

  static final List<DemoSession> _sessions = [];
  static int _nextId = 0;
  static int _nextCode = 483921;

  static String passwordFor(UserRole role) => _accounts[role]!.password;

  static bool twoStepEnabledFor(UserRole role) =>
      _accounts[role]!.twoStepEnabled;

  static void setTwoStepEnabled(UserRole role, bool enabled) {
    _accounts[role]!.twoStepEnabled = enabled;
  }

  static bool loginAlertsEnabledFor(UserRole role) =>
      _accounts[role]!.loginAlertsEnabled;

  static void setLoginAlertsEnabled(UserRole role, bool enabled) {
    _accounts[role]!.loginAlertsEnabled = enabled;
  }

  static DateTime? lastLoginAlertFor(UserRole role) =>
      _accounts[role]!.lastLoginAlert;

  static bool changePassword(
    UserRole role, {
    required String currentPassword,
    required String newPassword,
  }) {
    final account = _accounts[role]!;
    if (account.password != currentPassword) return false;
    account.password = newPassword;
    return true;
  }

  static String createVerificationCode() {
    _nextCode = (_nextCode * 48271) % 1000000;
    return _nextCode.toString().padLeft(6, '0');
  }

  static bool verifyCode(String expected, String entered) =>
      expected == entered.trim();

  static List<DemoGuardian> get guardians => List.unmodifiable(_guardians);

  static void addGuardian(String name, String relationship) {
    _guardians.add(
      DemoGuardian(name: name.trim(), relationship: relationship.trim()),
    );
  }

  static void removeGuardian(DemoGuardian guardian) {
    _guardians.remove(guardian);
  }

  static List<DemoSession> sessionsFor(UserRole role) =>
      List.unmodifiable(_sessions.where((session) => session.userRole == role));

  static void recordLogin(UserRole role) {
    if (_accounts[role]!.loginAlertsEnabled) {
      _accounts[role]!.lastLoginAlert = DateTime.now();
    }
    for (final session in _sessions) {
      if (session.userRole == role) {
        session.isCurrent = false;
      }
    }
    _sessions.add(
      DemoSession(
        id: 'demo-session-${_nextId++}',
        userRole: role,
        deviceName: _deviceName,
        signedInAt: DateTime.now(),
        isCurrent: true,
      ),
    );
  }

  static void endSession(String id) {
    _sessions.removeWhere((session) => session.id == id);
  }

  static void endAllSessions() {
    _sessions.clear();
  }

  static void endSessionsFor(UserRole role) {
    _sessions.removeWhere((session) => session.userRole == role);
  }

  static String get _deviceName {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'Android device';
      case TargetPlatform.iOS:
        return 'iPhone or iPad';
      case TargetPlatform.windows:
        return 'Windows device';
      case TargetPlatform.macOS:
        return 'Mac';
      case TargetPlatform.linux:
        return 'Linux device';
      case TargetPlatform.fuchsia:
        return 'Device';
    }
  }
}

class DemoGuardian {
  final String name;
  final String relationship;

  const DemoGuardian({required this.name, required this.relationship});
}

class DemoSession {
  final String id;
  final UserRole userRole;
  final String deviceName;
  final DateTime signedInAt;
  bool isCurrent;

  DemoSession({
    required this.id,
    required this.userRole,
    required this.deviceName,
    required this.signedInAt,
    this.isCurrent = false,
  });
}

class _DemoAccountSecurity {
  String password = 'password123';
  bool twoStepEnabled = false;
  bool loginAlertsEnabled = false;
  DateTime? lastLoginAlert;
}
