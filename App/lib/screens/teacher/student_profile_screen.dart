import 'package:final_project/core/app_ui.dart';

import '../../core/widgets/backend_panels.dart';

class StudentProfileScreen extends StatelessWidget {
  final String? childId;
  final String studentName;
  final String age;
  final String school;
  final String bloodType;
  final String guardianName;
  final String guardianRelation;
  final String avatarUrl;
  final bool canEdit;

  const StudentProfileScreen({
    super.key,
    this.childId,
    this.studentName = 'Child details',
    this.age = 'Unavailable',
    this.school = 'Unavailable',
    this.bloodType = 'Unavailable',
    this.guardianName = 'Unavailable',
    this.guardianRelation = 'Unavailable',
    this.avatarUrl = '',
    this.canEdit = false,
  });

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(studentName)),
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(18),
      child: ChildPanel(childId: childId),
    ),
  );
}
