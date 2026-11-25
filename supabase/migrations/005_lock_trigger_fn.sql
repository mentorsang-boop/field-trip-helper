-- v1.0.0-rc1 : 트리거 함수는 직접 호출하지 못하게
revoke execute on function ft_on_trip_created() from authenticated;
