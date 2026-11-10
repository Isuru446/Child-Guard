import 'package:flutter/services.dart';

/// Native composers only: never places a call or reports message delivery.
class PhoneActions {
  static const channel = MethodChannel('child_guard/phone');
  static String normalize(String phone) =>
      phone.replaceAll(RegExp(r'[^+0-9]'), '');
  static Future<bool> dial(String phone) async {
    try {
      return await channel.invokeMethod<bool>('dial', normalize(phone)) == true;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> message(String phone, String message) async {
    try {
      return await channel.invokeMethod<bool>('sms', {
            'phone': normalize(phone),
            'message': message,
          }) ==
          true;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> share(String message) async {
    try {
      return await channel.invokeMethod<bool>('share', message) == true;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
