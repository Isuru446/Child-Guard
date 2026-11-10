import 'account_management_screen.dart';
import '../pickup/pickup_screen.dart';
import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/responsive_content.dart';
import '../../core/widgets/authenticated_back.dart';
import '../../models/user_role.dart';
import '../auth/role_selection_screen.dart';
import '../teacher/student_profile_screen.dart';
import 'help_support_screen.dart';
import 'emergency_contacts_screen.dart';
import 'settings_screen.dart';
import 'teacher_profile_screen.dart';
import 'widgets/authorized_pickups_card.dart';

class ProfileScreen extends StatelessWidget {
  final UserRole userRole;

  const ProfileScreen({super.key, this.userRole = UserRole.parent});

  bool get _isTeacher => userRole == UserRole.teacher;

  Future<void> _handleLogout(BuildContext context) async {
    await BackendSession.instance.logout();
    if (!context.mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (context) => const RoleSelectionScreen()),
      (route) => false,
    );
  }

  void _showAuthorizedPickups(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const PickupScreen()),
      );
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
          child: Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(22),
            ),
            child: const AuthorizedPickupsSection(),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final name =
        BackendSession.instance.user?['username'] as String? ?? 'ChildGuard';
    final colors = Theme.of(context).colorScheme;

    return AuthenticatedBackScope(
      userRole: userRole,
      child: Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: SafeArea(
          child: SingleChildScrollView(
            child: ResponsiveContent(
              maxWidth: 600,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
                child: Column(
                  children: [
                    Row(
                      children: [
                        AuthenticatedBackButton(userRole: userRole),
                        Expanded(
                          child: Text(
                            'Profile',
                            style: TextStyle(
                              color: colors.onSurface,
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: context.translate('App settings'),
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  SettingsScreen(userRole: userRole),
                            ),
                          ),
                          icon: Icon(
                            Icons.settings_outlined,
                            color: colors.onSurface,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    CircleAvatar(
                      radius: 44,
                      backgroundColor: const Color(0xFFE2EDFA),
                      child: Icon(
                        _isTeacher ? Icons.person_rounded : Icons.face_rounded,
                        size: 48,
                        color: AppColors.primaryBlue,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      name,
                      style: TextStyle(
                        color: colors.onSurface,
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _isTeacher ? 'Teacher' : 'Parent',
                      style: TextStyle(
                        color: colors.onSurfaceVariant,
                        fontSize: 13,
                      ),
                    ),
                    BackendFeed(
                      tab: 3,
                      load: () => BackendSession.instance.api.request(
                        '/api/v1/mobile/profile',
                      ),
                      builder: (context, profile) => ListTile(
                        leading: profile['profile']?['photo']?['id'] == null
                            ? null
                            : ClipOval(
                                child: Image.network(
                                  '${BackendSession.instance.api.base}/api/v1/account/photos/${profile['profile']['photo']['id']}?v=${Uri.encodeQueryComponent(profile['profile']['photo']['createdAt'].toString())}',
                                  headers: {
                                    'Authorization':
                                        'Bearer ${BackendSession.instance.api.token}',
                                  },
                                  width: 40,
                                  height: 40,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, _, _) => const CircleAvatar(
                                    child: Icon(Icons.person_outline),
                                  ),
                                ),
                              ),
                        title: Text(
                          profile['center']?['name'] as String? ??
                              'Center unavailable',
                        ),
                        subtitle: Text(profile['role'] as String),
                      ),
                    ),
                    const SizedBox(height: 22),
                    if (!_isTeacher) ...[
                      _ProfileMenuTile(
                        icon: Icons.child_care_rounded,
                        title: 'My Child',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const StudentProfileScreen(
                              studentName: 'My children',
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 9),
                      _ProfileMenuTile(
                        icon: Icons.phone_rounded,
                        title: 'Emergency Contacts',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                EmergencyContactsScreen(userRole: userRole),
                          ),
                        ),
                      ),
                      const SizedBox(height: 9),
                      _ProfileMenuTile(
                        icon: Icons.verified_user_outlined,
                        title: 'Authorized Pickups',
                        onTap: () => _showAuthorizedPickups(context),
                      ),
                      const SizedBox(height: 9),
                    ] else ...[
                      _ProfileMenuTile(
                        icon: Icons.groups_rounded,
                        title: 'My Profile',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const TeacherProfileScreen(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 9),
                      _ProfileMenuTile(
                        icon: Icons.phone_rounded,
                        title: 'Emergency Contacts',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                EmergencyContactsScreen(userRole: userRole),
                          ),
                        ),
                      ),
                      const SizedBox(height: 9),
                    ],
                    _ProfileMenuTile(
                      icon: Icons.manage_accounts_outlined,
                      title: 'Account details and requests',
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const AccountManagementScreen(),
                        ),
                      ),
                    ),
                    const SizedBox(height: 9),
                    _ProfileMenuTile(
                      icon: Icons.tune_rounded,
                      title: 'App Settings',
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => SettingsScreen(userRole: userRole),
                        ),
                      ),
                    ),
                    const SizedBox(height: 9),
                    _ProfileMenuTile(
                      icon: Icons.help_outline_rounded,
                      title: 'Help & Support',
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => HelpSupportScreen(userRole: userRole),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    _ProfileMenuTile(
                      icon: Icons.logout_rounded,
                      title: 'Logout',
                      isDestructive: true,
                      onTap: () => _handleLogout(context),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileMenuTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final bool isDestructive;

  const _ProfileMenuTile({
    required this.icon,
    required this.title,
    required this.onTap,
    this.isDestructive = false,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final color = isDestructive ? AppColors.sosRed : AppColors.primaryBlue;
    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        borderRadius: BorderRadius.circular(15),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
          child: Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: isDestructive ? AppColors.sosRed : colors.onSurface,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: colors.onSurfaceVariant,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
