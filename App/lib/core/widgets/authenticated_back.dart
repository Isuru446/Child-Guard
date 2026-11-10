import 'package:flutter/material.dart';

import '../../models/user_role.dart';
import '../../screens/main_wrapper.dart';
import '../backend.dart';

/// Tab destinations return within the existing shell; pushed routes use their
/// real history. A standalone authenticated destination replaces itself once.
Future<void> authenticatedBack(BuildContext context, UserRole role) async {
  if (MainWrapperScreen.backFromTab(context)) return;
  final navigator = Navigator.of(context);
  if (navigator.canPop()) {
    await navigator.maybePop();
    return;
  }
  final trustedRole = BackendSession.instance.user?['role'];
  final homeRole = trustedRole == 'TEACHER'
      ? UserRole.teacher
      : trustedRole == 'PARENT'
      ? UserRole.parent
      : role;
  if (!BackendSession.instance.signedIn) return;
  navigator.pushReplacement(
    MaterialPageRoute(builder: (_) => MainWrapperScreen(userRole: homeRole)),
  );
}

class AuthenticatedBackButton extends StatelessWidget {
  final UserRole userRole;
  const AuthenticatedBackButton({super.key, required this.userRole});

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: MaterialLocalizations.of(context).backButtonTooltip,
    icon: const Icon(Icons.arrow_back_ios_new_rounded),
    onPressed: () => authenticatedBack(context, userRole),
  );
}

class AuthenticatedBackScope extends StatelessWidget {
  final UserRole userRole;
  final Widget child;
  const AuthenticatedBackScope({
    super.key,
    required this.userRole,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    // Offstage IndexedStack destinations must not register competing PopScopes.
    if (MainWrapperScreen.isTabRoute(context)) return child;
    return PopScope(
      canPop: Navigator.of(context).canPop(),
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) authenticatedBack(context, userRole);
      },
      child: child,
    );
  }
}
