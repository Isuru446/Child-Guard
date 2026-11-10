import '../../core/backend.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/app_language_controller.dart';
import '../../core/app_theme_controller.dart';
import '../../core/widgets/responsive_content.dart';
import '../../models/user_role.dart';
import 'help_support_screen.dart';
import 'privacy_safety_screen.dart';

class SettingsScreen extends StatefulWidget {
  final UserRole userRole;

  const SettingsScreen({super.key, required this.userRole});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final Map<String, bool> _preferences =
      widget.userRole == UserRole.teacher
      ? {'attendance': true, 'pickup': true, 'safety': true, 'location': false}
      : {'attendance': true, 'pickup': true, 'safety': true, 'location': true};
  bool get _isTeacher => widget.userRole == UserRole.teacher;

  void _updatePreference(String key, bool value) {
    if (BackendSession.instance.signedIn) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Background notification subscriptions are unavailable. Foreground alerts and recorded GPS refresh automatically.',
          ),
        ),
      );
      return;
    }
    setState(() => _preferences[key] = value);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Settings'),
        leading: IconButton(
          tooltip: context.translate('Back'),
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
          child: ResponsiveContent(
            maxWidth: 640,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SettingsIntro(isTeacher: _isTeacher),
                const ListTile(
                  subtitle: Text(
                    'Alerts and recorded GPS refresh while their screens are open. Background push notifications and subscription preferences are unavailable.',
                  ),
                ),
                const SizedBox(height: 22),
                _SettingsSection(
                  title: 'NOTIFICATIONS',
                  children: [
                    _PreferenceTile(
                      icon: Icons.fact_check_outlined,
                      title: _isTeacher
                          ? 'Attendance updates'
                          : 'Attendance alerts',
                      subtitle: _isTeacher
                          ? 'Know when a student is marked present or absent.'
                          : 'Get notified when your child checks in or out.',
                      value: _preferences['attendance']!,
                      onChanged: (value) =>
                          _updatePreference('attendance', value),
                    ),
                    _PreferenceTile(
                      icon: Icons.verified_user_outlined,
                      title: _isTeacher
                          ? 'Pickup verification'
                          : 'Pickup alerts',
                      subtitle: _isTeacher
                          ? 'Get updates when a pickup is verified.'
                          : 'Know when an authorized pickup is completed.',
                      value: _preferences['pickup']!,
                      onChanged: (value) => _updatePreference('pickup', value),
                    ),
                    _PreferenceTile(
                      icon: Icons.crisis_alert_outlined,
                      title: 'Safety alerts',
                      subtitle: _isTeacher
                          ? 'Receive important daycare safety updates.'
                          : 'Receive urgent safety and SOS notifications.',
                      value: _preferences['safety']!,
                      onChanged: (value) => _updatePreference('safety', value),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingsSection(
                  title: 'APP PREFERENCES',
                  children: [
                    const _ThemePreferenceTile(),
                    _PreferenceTile(
                      icon: Icons.location_on_outlined,
                      title: _isTeacher
                          ? 'Child location updates'
                          : 'Location updates',
                      subtitle: _isTeacher
                          ? 'Show updates for your assigned students.'
                          : 'Show updates when your child’s location changes.',
                      value: _preferences['location']!,
                      onChanged: (value) =>
                          _updatePreference('location', value),
                    ),
                    ValueListenableBuilder<Locale>(
                      valueListenable: AppLanguageController.locale,
                      builder: (context, locale, _) => ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                        ),
                        leading: const _SettingsIcon(
                          icon: Icons.language_rounded,
                          color: Color(0xFF168BFA),
                        ),
                        title: const Text(
                          'Language',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: const Text(
                          'Choose your preferred language',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                        trailing: DropdownButton<String>(
                          value: locale.languageCode,
                          underline: const SizedBox.shrink(),
                          items: const [
                            DropdownMenuItem(
                              value: 'en',
                              child: Text('English'),
                            ),
                            DropdownMenuItem(
                              value: 'si',
                              child: Text('Sinhala'),
                            ),
                            DropdownMenuItem(value: 'ta', child: Text('Tamil')),
                          ],
                          onChanged: (value) {
                            if (value != null) {
                              AppLanguageController.setLanguage(value);
                            }
                          },
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingsSection(
                  title: 'ACCOUNT',
                  children: [
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                      ),
                      leading: const _SettingsIcon(
                        icon: Icons.shield_outlined,
                        color: Color(0xFF18A66A),
                      ),
                      title: const Text(
                        'Privacy & safety',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        _isTeacher
                            ? 'Student information is for authorized school use.'
                            : 'Your child’s safety information is protected.',
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) =>
                              PrivacySafetyScreen(userRole: widget.userRole),
                        ),
                      ),
                    ),
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                      ),
                      leading: const _SettingsIcon(
                        icon: Icons.help_outline_rounded,
                        color: Color(0xFF168BFA),
                      ),
                      title: const Text(
                        'Help & Support',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: const Text(
                        'Find quick answers or get in touch with your school.',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) =>
                              HelpSupportScreen(userRole: widget.userRole),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Center(
                  child: Text(
                    'Preferences are saved for this demo session only.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsIntro extends StatelessWidget {
  final bool isTeacher;

  const _SettingsIntro({required this.isTeacher});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.primaryBlue, Color(0xFF168BFA)],
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: Color(0x33FFFFFF),
            child: Icon(Icons.tune_rounded, color: Colors.white),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isTeacher ? 'Teacher preferences' : 'Parent preferences',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  isTeacher
                      ? 'Choose how you receive daycare updates.'
                      : 'Personalize your child safety updates.',
                  style: const TextStyle(
                    color: Color(0xFFE5F1FF),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsSection extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const _SettingsSection({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            title,
            style: TextStyle(
              color: colors.onSurfaceVariant,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
        ),
        Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(17),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const Divider(height: 1, indent: 58, endIndent: 14),
                children[i],
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _PreferenceTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _PreferenceTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SwitchListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
      secondary: _SettingsIcon(icon: icon, color: AppColors.primaryBlue),
      title: Text(
        title,
        style: TextStyle(
          color: colors.onSurface,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12),
      ),
      value: value,
      onChanged: onChanged,
      activeTrackColor: colors.primary,
    );
  }
}

class _ThemePreferenceTile extends StatelessWidget {
  const _ThemePreferenceTile();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: AppThemeController.themeMode,
      builder: (context, themeMode, _) => SwitchListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
        secondary: _SettingsIcon(
          icon: themeMode == ThemeMode.dark
              ? Icons.dark_mode_outlined
              : Icons.light_mode_outlined,
          color: colors.primary,
        ),
        title: Text(
          'Dark mode',
          style: TextStyle(
            color: colors.onSurface,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          themeMode == ThemeMode.dark
              ? 'Dark appearance is on'
              : 'Use a darker appearance across the app',
          style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12),
        ),
        value: themeMode == ThemeMode.dark,
        onChanged: (enabled) {
          AppThemeController.themeMode.value = enabled
              ? ThemeMode.dark
              : ThemeMode.light;
        },
        activeTrackColor: colors.primary,
      ),
    );
  }
}

class _SettingsIcon extends StatelessWidget {
  final IconData icon;
  final Color color;

  const _SettingsIcon({required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return CircleAvatar(
      radius: 18,
      backgroundColor: color.withValues(alpha: isDark ? 0.2 : 0.1),
      child: Icon(icon, size: 19, color: color),
    );
  }
}
