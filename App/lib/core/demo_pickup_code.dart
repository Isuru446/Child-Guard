import 'dart:math';

class DemoPickupCode {
  DemoPickupCode._();

  static String _code = '482715';
  static DateTime _expiresAt = DateTime.now().add(const Duration(seconds: 165));

  static String get current => _code;

  static String generate() {
    _code = (100000 + Random.secure().nextInt(900000)).toString();
    _expiresAt = DateTime.now().add(const Duration(seconds: 165));
    return _code;
  }

  static bool consume(String enteredCode) {
    if (!DateTime.now().isBefore(_expiresAt) || enteredCode != _code) {
      return false;
    }
    _code = '';
    return true;
  }
}
