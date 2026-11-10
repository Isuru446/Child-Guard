import bcrypt from 'bcryptjs';

export async function findLoginUser(db,identifier){
 const user=await db.user.findUnique({where:{username:identifier}});
 if(user||!identifier.includes('@')||!db.userProfile?.findUnique)return user;
 const profile=await db.userProfile.findUnique({where:{email:identifier.toLowerCase()},select:{userId:true}});
 return profile?db.user.findUnique({where:{id:profile.userId}}):null;
}

// Status is not authentication. Reveal it only after proving the application
// password; unknown/wrong credentials retain the normal generic response.
export async function registrationLoginStatus(db,username,password,dummyHash){
 let row;
 try{
  if(db.registrationApplication?.findUnique){
   row=await db.registrationApplication.findUnique({where:{username},select:{status:true,passwordHash:true,role:true}});
   if(!row&&username.includes('@'))row=await db.registrationApplication.findUnique({where:{email:username.toLowerCase()},select:{status:true,passwordHash:true,role:true}});
  }
 }catch(error){if(!['P2021','P2022'].includes(error.code))throw error;}
 const valid=await bcrypt.compare(password,row?.passwordHash||dummyHash);
 if(!valid||!row?.passwordHash||!['PARENT','TEACHER'].includes(row.role)||!['PENDING','REJECTED'].includes(row.status))return null;
 return row.status==='PENDING'
  ?{code:'REGISTRATION_PENDING',message:'Waiting for administrator approval.'}
  :{code:'REGISTRATION_REJECTED',message:'Registration was rejected. Open registration status to review the decision and correct your application.'};
}
