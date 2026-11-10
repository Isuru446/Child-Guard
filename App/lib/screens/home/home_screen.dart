import 'teacher_home_dashboard.dart';
import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/app_avatar.dart';
import '../../models/user_role.dart';
import '../alerts/alerts_screen.dart';
import '../alerts/sos_alert_screen.dart';
import '../pickup/pickup_screen.dart';
import '../attendance/attendance_record_screen.dart';
import '../history/history_screen.dart';
import '../map/map_screen.dart';
import '../profile/profile_screen.dart';
import '../profile/account_management_screen.dart';
import '../main_wrapper.dart';
import '../profile/settings_screen.dart';
import '../profile/help_support_screen.dart';

class HomeScreen extends StatefulWidget {
  final UserRole userRole;
  final VoidCallback? onNavigateToMap;

  const HomeScreen({
    super.key,
    this.userRole = UserRole.parent,
    this.onNavigateToMap,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  String? _selectedChildId;
  UserRole get userRole => widget.userRole;
  VoidCallback? get onNavigateToMap => widget.onNavigateToMap;
  bool get _isTeacher => userRole == UserRole.teacher;

  void _openMap(BuildContext context) {
    if (onNavigateToMap != null) {
      onNavigateToMap!();
    } else if (!MainWrapperScreen.switchTab(context, 1)) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => MapScreen(userRole: userRole)),
      );
    }
  }

  void _openAlerts(BuildContext context) {
    if (!MainWrapperScreen.switchTab(context, 2)) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => AlertsScreen(userRole: userRole)),
      ).then((_) {
        if (_isTeacher && context.mounted) backendRefresh.value++;
      });
    }
  }

  void _openHistory(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            HistoryScreen(userRole: userRole, childId: _selectedChildId),
      ),
    );
  }

  void _openAttendance(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => AttendanceRecordScreen(isTeacherView: _isTeacher),
      ),
    ).then((_) {
      if (_isTeacher && context.mounted) backendRefresh.value++;
    });
  }

  void _openTransport(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('School transport'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Bus boarding and inferred exit updates appear in Other Notifications when daycare transport monitoring is active.',
            ),
            SizedBox(height: 8),
            Text(
              'Live bus journey tracking is not available. BLE contact does not verify physical boarding or exit.',
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
          FilledButton.icon(
            onPressed: () {
              Navigator.pop(dialogContext);
              _openMap(context);
            },
            icon: const Icon(Icons.location_on_outlined),
            label: const Text('View location'),
          ),
        ],
      ),
    );
  }

  void _openPickup(BuildContext context) => Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => const PickupScreen()),
  );

  void _openSos(BuildContext context) => Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => SosAlertScreen(userRole: userRole)),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      drawer: _buildDrawer(context),
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 700),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeader(context),
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_isTeacher)
                        Padding(
                          padding: const EdgeInsets.only(top: 14),
                          child: TeacherHomeDashboard(
                            onOpenAlerts: () => _openAlerts(context),
                            onOpenAttendance: () => _openAttendance(context),
                          ),
                        )
                      else
                        Transform.translate(
                          offset: const Offset(0, -18),
                          child: _buildChildCard(context),
                        ),
                      const SizedBox(height: 0),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final columns = constraints.maxWidth < 330 ? 2 : 3;
                          final cellWidth =
                              (constraints.maxWidth - (columns - 1) * 10) /
                              columns;
                          final actions = <Widget>[
                            _QuickAction(
                              icon: Icons.location_on_outlined,
                              label: 'Live Location',
                              color: AppColors.accentBlue,
                              onTap: () => _openMap(context),
                            ),
                            _QuickAction(
                              icon: Icons.calendar_month_outlined,
                              label: 'Attendance',
                              color: const Color(0xFF158BFF),
                              onTap: () => _openAttendance(context),
                            ),
                            _QuickAction(
                              icon: Icons.directions_bus_outlined,
                              label: 'Transport',
                              color: const Color(0xFFD89A00),
                              onTap: () => _openTransport(context),
                            ),
                            _QuickAction(
                              icon: Icons.notifications_none_rounded,
                              label: 'Alerts',
                              color: const Color(0xFFEF861C),
                              onTap: () => _openAlerts(context),
                            ),
                            _QuickAction(
                              icon: Icons.call_outlined,
                              label: 'SOS',
                              color: AppColors.sosRed,
                              onTap: () => _openSos(context),
                            ),
                            _QuickAction(
                              icon: _isTeacher
                                  ? Icons.qr_code_scanner
                                  : Icons.person_pin_circle_outlined,
                              label: 'Pickup',
                              color: const Color(0xFF1683C7),
                              onTap: () => _openPickup(context),
                            ),
                            if (!_isTeacher)
                              _QuickAction(
                                icon: Icons.insights_outlined,
                                label: 'Activity',
                                color: AppColors.accentBlue,
                                onTap: () => _openHistory(context),
                              ),
                          ];
                          return Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 10,
                            runSpacing: 10,
                            children: actions
                                .map(
                                  (action) => SizedBox(
                                    width: cellWidth,
                                    height: cellWidth / 0.96,
                                    child: action,
                                  ),
                                )
                                .toList(),
                          );
                        },
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

  Widget _buildDrawer(BuildContext context) {
    Widget destination(IconData icon, String label, VoidCallback action) =>
        ListTile(
          leading: Icon(icon, color: AppColors.primaryBlue),
          title: Text(label),
          onTap: () {
            _scaffoldKey.currentState?.closeDrawer();
            action();
          },
        );
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            DrawerHeader(
              decoration: const BoxDecoration(color: AppColors.primaryBlue),
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  _isTeacher ? 'Teacher menu' : 'Parent menu',
                  style: const TextStyle(color: Colors.white, fontSize: 22),
                ),
              ),
            ),
            destination(Icons.home_outlined, 'Home', () {}),
            destination(
              Icons.location_on_outlined,
              'Map',
              () => _openMap(context),
            ),
            destination(
              Icons.calendar_month_outlined,
              'Attendance',
              () => _openAttendance(context),
            ),
            destination(
              Icons.notifications_outlined,
              'Alerts',
              () => _openAlerts(context),
            ),
            if (!_isTeacher)
              destination(
                Icons.insights_outlined,
                'Activity',
                () => _openHistory(context),
              ),
            destination(
              Icons.verified_user_outlined,
              'Pickup',
              () => _openPickup(context),
            ),
            destination(
              Icons.person_outline,
              'Profile',
              () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => ProfileScreen(userRole: userRole),
                ),
              ),
            ),
            destination(
              Icons.settings_outlined,
              'App Settings',
              () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => SettingsScreen(userRole: userRole),
                ),
              ),
            ),
            destination(
              Icons.help_outline_rounded,
              'Help & Support',
              () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => HelpSupportScreen(userRole: userRole),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    final name =
        BackendSession.instance.user?['username'] as String? ?? 'ChildGuard';
    final now = DateTime.now();
    final greeting = now.hour < 12
        ? 'Good Morning,'
        : now.hour < 17
        ? 'Good Afternoon,'
        : 'Good Evening,';
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final dateLabel =
        '${weekdays[now.weekday - 1]}, ${now.day} ${months[now.month - 1]} ${now.year}';
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        20,
        MediaQuery.paddingOf(context).top + 12,
        20,
        34,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF06469B), Color(0xFF003579)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -42,
            top: -62,
            child: Container(
              width: 170,
              height: 170,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.08),
                  width: 25,
                ),
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Material(
                    color: Colors.white.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(12),
                    child: IconButton(
                      tooltip: context.translate('Open menu'),
                      onPressed: () => _scaffoldKey.currentState?.openDrawer(),
                      icon: const Icon(
                        Icons.menu_rounded,
                        color: Colors.white,
                        size: 22,
                      ),
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: context.translate('Notifications'),
                    onPressed: () => _openAlerts(context),
                    icon: const Icon(
                      Icons.notifications_active_rounded,
                      color: Colors.white,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 6),
                  InkWell(
                    key: const ValueKey('home-profile-avatar'),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AccountManagementScreen(),
                      ),
                    ),
                    customBorder: const CircleBorder(),
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: const AppAvatar(
                        size: 38,
                        fallbackIcon: Icons.person_rounded,
                        backgroundColor: Color(0xFFE6F1FF),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                greeting,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.9),
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                '$name${_isTeacher ? '' : ' 👋'}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 25,
                  height: 1.15,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 5),
              Row(
                children: [
                  Icon(
                    Icons.calendar_today_rounded,
                    color: Colors.white.withValues(alpha: 0.82),
                    size: 12,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    dateLabel,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.82),
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildChildCard(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.surface,
    borderRadius: BorderRadius.circular(18),
    elevation: 2,
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: ChildPanel(
        tab: 0,
        onChildSelected: (id) => _selectedChildId = id,
        onOpenUpdates: (id) => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => AlertsScreen(
              userRole: UserRole.parent,
              childId: id,
              category: 'updates',
            ),
          ),
        ),
        onOpenAlerts: (childId) => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => AlertsScreen(
              userRole: UserRole.parent,
              childId: childId,
              category: 'safety',
            ),
          ),
        ),
      ),
    ),
  );
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(17),
      elevation: 0,
      child: InkWell(
        borderRadius: BorderRadius.circular(17),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: const Color(0xFFE8EFF8)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0A123B75),
                blurRadius: 13,
                offset: Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color.withValues(alpha: 0.1),
                ),
                alignment: Alignment.center,
                child: Icon(icon, color: color, size: 25),
              ),
              const SizedBox(height: 5),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: colors.onSurface,
                  fontSize: 10,
                  height: 1.1,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
