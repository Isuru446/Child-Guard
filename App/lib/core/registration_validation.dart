/// Mirrors the public registration schema; credentials are never logged.
class RegistrationValidation {
  static String? field(String field, String? raw) {
    final value = (raw ?? '').trim();
    if (value.isEmpty) return 'Required';
    switch (field) {
      case 'fullName':
        return value.length < 2 || value.length > 150
            ? 'Use 2–150 characters for the full name'
            : null;
      case 'username':
        return value.length < 3 ||
                value.length > 100 ||
                !RegExp(r'^[A-Za-z0-9._@+-]+$').hasMatch(value)
            ? 'Use 3–100 letters, numbers or . _ @ + - for the username'
            : null;
      case 'email':
        return value.length > 254 ||
                !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value)
            ? 'Enter a valid email address'
            : null;
      case 'phone':
        final digits = value.replaceAll(RegExp(r'\D'), '').length;
        return value.length > 30 ||
                digits < 7 ||
                digits > 15 ||
                !RegExp(r'^[+0-9 ()-]+$').hasMatch(value)
            ? 'Use a phone number with 7–15 digits and optional + ( ) spaces or -'
            : null;
      case 'centerCode':
      case 'claimCode':
        return RegExp(r'^[a-f0-9]{64}$').hasMatch(value)
            ? null
            : field == 'centerCode'
            ? 'Enter the 64-character invitation code supplied by your center'
            : 'Enter the 64-character one-time claim code supplied by your center';
      case 'existingChildId':
        return RegExp(
              r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
            ).hasMatch(value)
            ? null
            : 'Enter the complete child reference supplied by your center (UUID)';
      case 'relationship':
        return value.length < 2 || value.length > 80
            ? 'Use 2–80 characters for your relationship (for example, Parent)'
            : null;
      case 'hardwareId':
        return value.length > 100
            ? 'Use at most 100 characters for the device identifier'
            : null;
      case 'dateOfBirth':
        final date = DateTime.tryParse(value);
        final today = DateTime.now().toUtc().toIso8601String().substring(0, 10);
        return !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ||
                date == null ||
                date.toIso8601String().substring(0, 10) != value ||
                value.compareTo(today) > 0
            ? 'Enter a real birth date, not in the future (YYYY-MM-DD)'
            : null;
    }
    return null;
  }
}
