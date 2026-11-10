import 'package:final_project/core/app_ui.dart';
import 'package:flutter/services.dart';

import '../core/app_colors.dart';
import '../core/backend.dart';
import '../core/widgets/backend_panels.dart';
import '../core/widgets/teacher_alert_watch.dart';
import 'auth/role_selection_screen.dart';
import '../models/user_role.dart';
import 'alerts/alerts_screen.dart';
import 'home/home_screen.dart';
import 'map/map_screen.dart';
import 'profile/profile_screen.dart';

class MainWrapperScreen extends StatefulWidget {
  final UserRole userRole;

  const MainWrapperScreen({super.key, this.userRole = UserRole.parent});

  static bool switchTab(BuildContext context, int index) {
    final state = context.findAncestorStateOfType<_MainWrapperScreenState>();
    if (state == null || index < 0 || index >= 4) {
      return false;
    }
    state.setTab(index);
    return true;
  }

  static bool isTabRoute(BuildContext context) {
    final state = context.findAncestorStateOfType<_MainWrapperScreenState>();
    return state != null &&
        ModalRoute.of(context) == ModalRoute.of(state.context);
  }

  static bool backFromTab(BuildContext context) {
    final state = context.findAncestorStateOfType<_MainWrapperScreenState>();
    if (state == null || !isTabRoute(context)) return false;
    state.backTab();
    return true;
  }

  @override
  State<MainWrapperScreen> createState() => _MainWrapperScreenState();
}

class _MainWrapperScreenState extends State<MainWrapperScreen> {
  int _currentIndex = 0;
  final List<int> _tabHistory = [];
  @override
  void initState() {
    super.initState();
    backendTab.value = 0;
    BackendSession.instance.addListener(_sessionChanged);
  }

  void _sessionChanged() {
    if (!mounted || BackendSession.instance.signedIn) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const RoleSelectionScreen()),
          (_) => false,
        );
      }
    });
  }

  @override
  void dispose() {
    BackendSession.instance.removeListener(_sessionChanged);
    super.dispose();
  }

  void setTab(int index) {
    if (index == _currentIndex) return;
    if (index == 0) {
      _tabHistory.clear();
    } else {
      _tabHistory.add(_currentIndex);
    }
    backendTab.value = index;
    setState(() {
      _currentIndex = index;
    });
  }

  void backTab() {
    final index = _tabHistory.isEmpty ? 0 : _tabHistory.removeLast();
    backendTab.value = index;
    setState(() => _currentIndex = index);
  }

  List<Widget> _buildScreens() {
    if (widget.userRole == UserRole.teacher) {
      // 4 tabs for Teacher: Home (0), Map (1), Alerts (2), Profile (3)
      return [
        HomeScreen(
          userRole: UserRole.teacher,
          onNavigateToMap: () => setTab(1),
        ),
        const MapScreen(userRole: UserRole.teacher),
        const AlertsScreen(userRole: UserRole.teacher),
        const ProfileScreen(userRole: UserRole.teacher),
      ];
    } else {
      // 4 tabs for Parent: Home (0), Map (1), Alerts (2), Profile (3)
      return [
        HomeScreen(userRole: UserRole.parent, onNavigateToMap: () => setTab(1)),
        const MapScreen(userRole: UserRole.parent),
        const AlertsScreen(userRole: UserRole.parent),
        const ProfileScreen(userRole: UserRole.parent),
      ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final shell = PopScope(
      canPop: _currentIndex == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) backTab();
      },
      child: _buildShell(context),
    );
    if (widget.userRole == UserRole.teacher) {
      return TeacherAlertWatch(
        onOpen: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => const AlertsScreen(userRole: UserRole.teacher),
          ),
        ),
        child: shell,
      );
    }
    return shell;
  }

  Widget _buildShell(BuildContext context) {
    final isTeacher = widget.userRole == UserRole.teacher;
    final screens = _buildScreens();
    final colors = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context);

    if (MediaQuery.sizeOf(context).width >= 800) {
      return Scaffold(
        body: Row(
          children: [
            SafeArea(
              child: NavigationRail(
                selectedIndex: _currentIndex,
                onDestinationSelected: setTab,
                labelType: NavigationRailLabelType.all,
                backgroundColor: colors.surface,
                leading: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 20),
                  child: Icon(
                    Icons.shield_outlined,
                    color: AppColors.primaryBlue,
                    size: 32,
                  ),
                ),
                destinations: [
                  NavigationRailDestination(
                    icon: Icon(Icons.home_outlined),
                    selectedIcon: Icon(Icons.home),
                    label: Text(context.translate('Home')),
                  ),
                  NavigationRailDestination(
                    icon: Icon(Icons.location_on_outlined),
                    selectedIcon: Icon(Icons.location_on),
                    label: Text(context.translate('Map')),
                  ),
                  NavigationRailDestination(
                    icon: Icon(Icons.notifications_outlined),
                    selectedIcon: Icon(Icons.notifications),
                    label: Text(context.translate('Alerts')),
                  ),
                  NavigationRailDestination(
                    icon: Icon(Icons.person_outline),
                    selectedIcon: Icon(Icons.person),
                    label: Text(context.translate('Profile')),
                  ),
                ],
              ),
            ),
            const VerticalDivider(width: 1),
            Expanded(
              child: AnnotatedRegion<SystemUiOverlayStyle>(
                value: _currentIndex == 0
                    ? SystemUiOverlayStyle.light
                    : SystemUiOverlayStyle.dark,
                child: BackendTabScope(
                  child: IndexedStack(index: _currentIndex, children: screens),
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      body: AnnotatedRegion<SystemUiOverlayStyle>(
        value: _currentIndex == 0
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark,
        child: BackendTabScope(
          child: IndexedStack(
            index: _currentIndex >= screens.length ? 0 : _currentIndex,
            children: screens,
          ),
        ),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: colors.surface,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 16,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex >= screens.length ? 0 : _currentIndex,
          onTap: (index) {
            setTab(index);
          },
          type: BottomNavigationBarType.fixed,
          backgroundColor: colors.surface,
          selectedItemColor: AppColors.primaryBlue,
          unselectedItemColor: const Color(0xFF94A3B8),
          selectedFontSize: 11,
          unselectedFontSize: 11,
          elevation: 0,
          items: isTeacher
              ? [
                  BottomNavigationBarItem(
                    icon: Icon(Icons.home_outlined),
                    activeIcon: Icon(Icons.home),
                    label: AppTranslations.translate(locale, 'Home'),
                  ),
                  BottomNavigationBarItem(
                    icon: Icon(Icons.location_on_outlined),
                    activeIcon: Icon(Icons.location_on),
                    label: AppTranslations.translate(locale, 'Map'),
                  ),
                  BottomNavigationBarItem(
                    icon: Icon(Icons.notifications_none_outlined),
                    activeIcon: Icon(Icons.notifications),
                    label: AppTranslations.translate(locale, 'Alerts'),
                  ),
                  BottomNavigationBarItem(
                    icon: Icon(Icons.person_outline),
                    activeIcon: Icon(Icons.person),
                    label: AppTranslations.translate(locale, 'Profile'),
                  ),
                ]
              : [
                  BottomNavigationBarItem(
                    icon: Icon(Icons.home_outlined),
                    activeIcon: Icon(Icons.home),
                    label: AppTranslations.translate(locale, 'Home'),
                  ),
                  BottomNavigationBarItem(
                    icon: Icon(Icons.location_on_outlined),
                    activeIcon: Icon(Icons.location_on),
                    label: AppTranslations.translate(locale, 'Map'),
                  ),
                  BottomNavigationBarItem(
                    icon: Icon(Icons.notifications_none_outlined),
                    activeIcon: Icon(Icons.notifications),
                    label: AppTranslations.translate(locale, 'Alerts'),
                  ),
                  BottomNavigationBarItem(
                    icon: Icon(Icons.person_outline),
                    activeIcon: Icon(Icons.person),
                    label: AppTranslations.translate(locale, 'Profile'),
                  ),
                ],
        ),
      ),
    );
  }
}
