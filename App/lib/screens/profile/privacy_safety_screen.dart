import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/demo_security_store.dart';
import '../../core/widgets/responsive_content.dart';
import '../../models/user_role.dart';
import 'account_security_screens.dart';

class PrivacySafetyScreen extends StatefulWidget {
  final UserRole userRole;

  const PrivacySafetyScreen({super.key, required this.userRole});

  @override
  State<PrivacySafetyScreen> createState() => _PrivacySafetyScreenState();
}

class _PrivacySafetyScreenState extends State<PrivacySafetyScreen> {
  bool get _isTeacher => widget.userRole == UserRole.teacher;

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      return const UnavailablePanel(
        title: 'Privacy & safety',
        message: 'Only authorized Guardian children or your permitted center can be viewed. GPS shows stored wearable evidence with timestamps, not proof of safety. Edit your own profile and contacts through Account details. Pickup authorization requires the reviewed pickup migration. SOS opens the native dialer; it does not dispatch help. Tamper alerts use authenticated physical loop observations. Closed-app push delivery is unavailable. Sign out on shared devices.',
      );
    }
    final colors = Theme.of(context).colorScheme;
    final lastLogin = DemoSecurityStore.lastLoginAlertFor(widget.userRole);
    final loginAlertSubtitle = lastLogin == null
        ? 'Record sign-ins locally; no push alerts are sent.'
        : 'Last local sign-in: ${MaterialLocalizations.of(context).formatMediumDate(lastLogin)} at ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(lastLogin))}. No push alerts are sent.';
    const teacherDataItems = [
      (
        Icons.admin_panel_settings_outlined,
        'Use student information for school duties only.',
      ),
      (
        Icons.people_alt_outlined,
        'Only access students you are authorized to support.',
      ),
      (
        Icons.verified_user_outlined,
        'Check a pickup person’s identity before releasing a student.',
      ),
    ];
    final accountItems = _isTeacher
        ? const [
            (
              Icons.lock_outline_rounded,
              'Keep your sign-in details private and use a strong password.',
            ),
            (
              Icons.logout_rounded,
              'Sign out when using a shared or public device.',
            ),
          ]
        : const [
            (
              Icons.lock_outline_rounded,
              'Keep your sign-in details private and use a strong password.',
            ),
            (
              Icons.people_outline_rounded,
              'Review who is authorized to pick up your child.',
            ),
          ];

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Privacy & safety'),
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
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [AppColors.primaryBlue, Color(0xFF168BFA)],
                    ),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const CircleAvatar(
                        backgroundColor: Color(0x33FFFFFF),
                        child: Icon(Icons.shield_rounded, color: Colors.white),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _isTeacher
                                  ? 'Protect student information'
                                  : 'Help keep your child safe',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _isTeacher
                                  ? 'Follow these guidelines when viewing student details and handling pickups.'
                                  : 'A few simple steps can help protect your child’s information and pickup details.',
                              style: const TextStyle(
                                color: Color(0xFFE5F1FF),
                                fontSize: 12,
                                height: 1.45,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                if (_isTeacher) ...[
                  _GuidanceSection(
                    title: 'STUDENT DATA & ACCESS',
                    items: teacherDataItems,
                  ),
                  const SizedBox(height: 20),
                ],
                _GuidanceSection(
                  title: 'ACCOUNT & PERSONAL SAFETY',
                  items: accountItems,
                ),
                const SizedBox(height: 20),
                Text(
                  'ACCOUNT SECURITY',
                  style: TextStyle(
                    color: colors.onSurfaceVariant,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.7,
                  ),
                ),
                const SizedBox(height: 9),
                Material(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(17),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      SwitchListTile(
                        secondary: const Icon(Icons.phonelink_lock_rounded),
                        title: const Text('Two-Step Verification'),
                        subtitle: const Text(
                          'Ask for a demo OTP after password login.',
                        ),
                        value: DemoSecurityStore.twoStepEnabledFor(
                          widget.userRole,
                        ),
                        onChanged: (enabled) => setState(
                          () => DemoSecurityStore.setTwoStepEnabled(
                            widget.userRole,
                            enabled,
                          ),
                        ),
                      ),
                      const Divider(height: 1, indent: 56),
                      ListTile(
                        leading: const Icon(Icons.password_rounded),
                        title: const Text('Change Password'),
                        subtitle: const Text(
                          'Update the password for this demo account.',
                        ),
                        trailing: const Icon(Icons.chevron_right_rounded),
                        onTap: _changePassword,
                      ),
                      const Divider(height: 1, indent: 56),
                      SwitchListTile(
                        secondary: const Icon(
                          Icons.notification_important_outlined,
                        ),
                        title: const Text('Login Alerts'),
                        subtitle: Text(loginAlertSubtitle),
                        value: DemoSecurityStore.loginAlertsEnabledFor(
                          widget.userRole,
                        ),
                        onChanged: (enabled) => setState(
                          () => DemoSecurityStore.setLoginAlertsEnabled(
                            widget.userRole,
                            enabled,
                          ),
                        ),
                      ),
                      if (!_isTeacher) ...[
                        const Divider(height: 1, indent: 56),
                        ListTile(
                          leading: const Icon(Icons.family_restroom_rounded),
                          title: const Text('Authorized Guardians'),
                          subtitle: Text(
                            '${DemoSecurityStore.guardians.length} trusted guardians',
                          ),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () =>
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) =>
                                      const AuthorizedGuardiansScreen(),
                                ),
                              ).then((_) {
                                if (mounted) setState(() {});
                              }),
                        ),
                      ],
                      const Divider(height: 1, indent: 56),
                      ListTile(
                        leading: const Icon(Icons.devices_other_rounded),
                        title: const Text('Active Sessions'),
                        subtitle: Text(
                          '${DemoSecurityStore.sessionsFor(widget.userRole).length} demo sessions on this device',
                        ),
                        trailing: const Icon(Icons.chevron_right_rounded),
                        onTap: () =>
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => ActiveSessionsScreen(
                                  userRole: widget.userRole,
                                ),
                              ),
                            ).then((_) {
                              if (mounted) setState(() {});
                            }),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  padding: const EdgeInsets.all(15),
                  decoration: BoxDecoration(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: colors.outlineVariant.withValues(alpha: 0.5),
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        size: 19,
                        color: colors.primary,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Demo only: changes are kept in app memory on this device. OTPs are displayed in-app, and no SMS, push alerts, backend password updates, or remote session controls are connected.',
                          style: TextStyle(
                            color: colors.onSurfaceVariant,
                            fontSize: 12,
                            height: 1.45,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _changePassword() async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => ChangePasswordDialog(userRole: widget.userRole),
    );
    if (!mounted || changed != true) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Password updated for this demo session. It resets when the app restarts.',
        ),
      ),
    );
  }
}

class _GuidanceSection extends StatelessWidget {
  final String title;
  final List<(IconData, String)> items;

  const _GuidanceSection({required this.title, required this.items});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 9),
          child: Text(
            title,
            style: TextStyle(
              color: colors.onSurfaceVariant,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.7,
            ),
          ),
        ),
        Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(17),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var index = 0; index < items.length; index++) ...[
                if (index > 0)
                  const Divider(height: 1, indent: 58, endIndent: 14),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 5,
                  ),
                  leading: CircleAvatar(
                    radius: 18,
                    backgroundColor: colors.primary.withValues(alpha: 0.1),
                    child: Icon(
                      items[index].$1,
                      size: 19,
                      color: colors.primary,
                    ),
                  ),
                  title: Text(
                    items[index].$2,
                    style: TextStyle(
                      color: colors.onSurface,
                      fontSize: 13,
                      height: 1.4,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
