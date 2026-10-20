package org.firstinspires.ftc.teamcode.subsystems;

import com.bylazar.field.FieldManager;
import com.bylazar.field.PanelsField;
import com.pedropathing.drivetrain.DrivePowers;
import com.pedropathing.follower.Follower;
import com.pedropathing.follower.ManualDrive;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.ivy.pedro.PedroCommands;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.qualcomm.robotcore.hardware.Gamepad;

import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Drivetrain implements Mechanism {
    private Follower follower;

    private double headingOffset = 0;
    private double speed = 1.0;

    public void initialize(Pose startPose) {
        follower = Constants.create(RobotController.hardwareMap());
        follower.setPose(startPose);
        headingOffset = 0;
        speed = 1.0;
    }

    public Follower getFollower() {
        return follower;
    }

    public Command drive(Gamepad gamepad, Alliance alliance) {
        return infinite(() -> {
            DrivePowers input = new DrivePowers(-gamepad.left_stick_y * speed, -gamepad.left_stick_x * speed, -gamepad.right_stick_x * speed);
            ManualDrive.driveOrHold(follower, ManualDrive.fieldCentric(input, follower.pose().heading(), alliance.fieldCentricOffset + headingOffset));
        });
    }

    public Command resetFieldCentric(Alliance alliance) {
        return Commands.instant(() -> headingOffset = -follower.pose().heading() - alliance.fieldCentricOffset);
    }

    public Command resetPose(Pose pose) {
        return Commands.instant(() -> follower.setPose(pose));
    }

    public Command setSpeed(double speed) {
        return Commands.instant(() -> this.speed = speed);
    }

    public Command follow(Path path) {
        return PedroCommands.follow(follower, path).requiring(this);
    }

    public Command hold() {
        return PedroCommands.hold(follower).requiring(this);
    }

    @Override
    public void periodic() {
        if (follower != null) {
            follower.update();
            publishPose();
        }
    }

    private void publishPose() {
        Pose pose = follower.pose();
        Telemetry.log("x", pose.x());
        Telemetry.log("y", pose.y());
        Telemetry.log("heading (deg)", Math.toDegrees(pose.heading()));

        FieldManager field = PanelsField.INSTANCE.getField();
        field.setOffsets(PanelsField.INSTANCE.getPresets().getPEDRO_PATHING());
        field.setStyle("transparent", "#3F51B5", 1.5);
        field.moveCursor(pose.x(), pose.y());
        field.circle(9);
        field.line(pose.x() + 9 * Math.cos(pose.heading()), pose.y() + 9 * Math.sin(pose.heading()));
        field.update();
    }
}
