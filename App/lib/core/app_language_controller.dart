import 'package:flutter/material.dart';

class AppLanguageController {
  AppLanguageController._();

  static final ValueNotifier<Locale> locale = ValueNotifier(const Locale('en'));

  static void setLanguage(String languageCode) {
    if (!const {'en', 'si', 'ta'}.contains(languageCode)) {
      throw ArgumentError.value(languageCode, 'languageCode');
    }
    locale.value = Locale(languageCode);
  }
}
